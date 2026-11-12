import { z } from "zod";
import type { Card, Section } from "../types/deck";

// Validation, the quote check and merging for P2 (cards) and P3 (grounding check).

export class CardsError extends Error {}

const rawCard = z.object({
  type: z.enum(["term", "qa", "cloze"]),
  front: z.string().min(1),
  back: z.string().min(1),
  // the model leaves these empty when the text can be read aloud as it is
  say_front: z.string().default(""),
  say_back: z.string().default(""),
  source_page: z.number().int(),
  source_quote: z.string().min(1),
});

const p2Schema = z.object({ cards: z.array(rawCard).min(1).max(20) });
const p3Schema = z.object({
  checks: z.array(z.object({ card_id: z.string(), in_source: z.boolean(), reason: z.string().optional() })),
});

const MIN_CARDS = 3;
const MAX_CARDS = 12;

/** Lower-case letters and digits only, single-spaced, so PDF spacing and punctuation don't hide a match. */
export function normalizeForMatch(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/** What a voice should read for a written card side: blanks become the word "blank". */
export function spokenFallback(text: string): string {
  return text.replace(/_{2,}/g, "blank").replace(/\s+/g, " ").trim();
}

/** The quote plus `radius` characters either side, cut from the page. Falls back to the start of the page. */
export function contextAround(quote: string, pageText: string, radius = 300): string {
  const words = quote
    .split(/\.{3}|…/)[0]
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  if (words.length > 0) {
    try {
      const match = new RegExp(words.join("[^\\p{L}\\p{N}]+"), "iu").exec(pageText);
      if (match) {
        const start = Math.max(0, match.index - radius);
        return pageText.slice(start, Math.min(pageText.length, match.index + match[0].length + radius)).trim();
      }
    } catch {
      // fall through to the page start
    }
  }
  return pageText.slice(0, radius * 2).trim();
}

/** True when the quote appears in the page text. A quote with "..." must have every part present. */
export function quoteInPage(quote: string, pageText: string): boolean {
  const page = normalizeForMatch(pageText);
  const parts = quote
    .split(/\.{3}|…/)
    .map(normalizeForMatch)
    .filter((p) => p.length >= 4);
  if (parts.length === 0) return false;
  return parts.every((p) => page.includes(p));
}

/**
 * Validates the model's cards for one section. Drops cards pointing at a page outside the section,
 * checks each quote against its page text, and gives every card a fresh id. Throws CardsError if too few remain.
 */
export function buildCards(input: unknown, section: Section, pageTexts: Map<number, string>): Card[] {
  const parsed = p2Schema.safeParse(input);
  if (!parsed.success) throw new CardsError("cards do not match the schema");

  const [from, to] = section.page_range;
  const kept = parsed.data.cards.filter((c) => c.source_page >= from && c.source_page <= to).slice(0, MAX_CARDS);
  if (kept.length < MIN_CARDS) throw new CardsError("too few usable cards");

  return kept.map((c, i) => {
    const found = quoteInPage(c.source_quote, pageTexts.get(c.source_page) ?? "");
    return {
      id: `${section.id}c${i + 1}`,
      section_id: section.id,
      type: c.type,
      front: c.front.trim(),
      back: c.back.trim(),
      say_front: c.say_front.trim() || spokenFallback(c.front),
      say_back: c.say_back.trim() || spokenFallback(c.back),
      source_page: c.source_page,
      source_quote: c.source_quote.trim(),
      quote_found: found,
      // provisional until the grounding check runs; a missing quote can never be in_source
      in_source: found,
      check_reason: found ? undefined : "We couldn't find this quote on the page.",
      edited_by_user: false,
    };
  });
}

/** Validates P3's output. Throws CardsError if it is malformed. */
export function parseChecks(input: unknown): Map<string, { in_source: boolean; reason?: string }> {
  const parsed = p3Schema.safeParse(input);
  if (!parsed.success) throw new CardsError("checks do not match the schema");
  return new Map(parsed.data.checks.map((c) => [c.card_id, { in_source: c.in_source, reason: c.reason?.trim() || undefined }]));
}

/**
 * Combines code and AI checks. A card is in_source only if its quote was found AND the checker agreed.
 * A card the checker skipped is flagged, never trusted.
 */
export function applyChecks(cards: Card[], checks: Map<string, { in_source: boolean; reason?: string }>): Card[] {
  return cards.map((card) => {
    if (!card.quote_found) return { ...card, in_source: false };
    const check = checks.get(card.id);
    if (!check) return { ...card, in_source: false, check_reason: "The checker did not review this card." };
    if (!check.in_source) {
      return { ...card, in_source: false, check_reason: check.reason ?? "The page may not fully support this answer." };
    }
    return { ...card, in_source: true, check_reason: undefined };
  });
}

/** Used when the checker itself failed: show the cards, but flag every one as unchecked. */
export function markUnchecked(cards: Card[]): Card[] {
  return cards.map((c) => ({
    ...c,
    in_source: false,
    check_reason: c.quote_found ? "This card could not be checked against your notes." : c.check_reason,
  }));
}
