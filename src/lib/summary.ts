import { z } from "zod";
import { callAI } from "./ai";
import type { Card, Deck, Section, Summary } from "../types/deck";

// The cheat-sheet text: validation of the model's summary (P5), a fallback written from the cards alone,
// and a fingerprint that tells whether a stored summary still matches the cards.

export class SummaryError extends Error {}

export const MAX_BULLETS = 4;
export const MAX_BULLET_WORDS = 18;
export const MAX_TERMS = 10;
export const MAX_MEANING_WORDS = 12;
const MAX_TERM_WORDS = 6;
const MAX_CARDS_PER_SECTION = 14;

const container = z.object({
  summary: z.object({
    bullets_by_section: z.array(z.unknown()),
    key_terms: z.array(z.unknown()),
  }),
});
const rawBullets = z.object({ section_id: z.string(), bullets: z.array(z.string()) });
const rawTerm = z.object({ term: z.string(), meaning: z.string() });

const clean = (s: string) => s.replace(/\s+/g, " ").trim();
export const wordCount = (s: string) => clean(s).split(" ").filter(Boolean).length;

/** Cuts text to `max` words and marks the cut. Returns the text unchanged when it already fits. */
export function clipWords(text: string, max: number): string {
  const words = clean(text).split(" ").filter(Boolean);
  if (words.length <= max) return words.join(" ");
  return `${words.slice(0, max).join(" ").replace(/[\s,;:.\-–—]+$/, "")}…`;
}

/** The cards a cheat sheet may use: only those the PDF supports. */
export const verifiedCards = (deck: Deck): Card[] => deck.cards.filter((c) => c.in_source);

/** A short fingerprint (FNV-1a) of the verified cards' text. It changes when a card is edited, added or removed. */
export function cardsFingerprint(cards: Card[]): string {
  const text = cards.filter((c) => c.in_source).map((c) => `${c.id}\u0001${c.front}\u0001${c.back}`).join("\u0002");
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

/**
 * Checks P5's answer. Unknown sections, over-long bullets and over-long meanings are dropped, never trimmed
 * mid-sentence, and the counts are capped. Throws only when nothing usable is left.
 */
export function parseSummary(json: unknown, sections: Section[]): Summary {
  const parsed = container.safeParse(json);
  if (!parsed.success) throw new SummaryError("summary does not match the schema");
  const known = new Set(sections.map((s) => s.id));

  const seen = new Set<string>();
  const bulletsBySection: Summary["bullets_by_section"] = [];
  for (const raw of parsed.data.summary.bullets_by_section) {
    const item = rawBullets.safeParse(raw);
    if (!item.success || !known.has(item.data.section_id) || seen.has(item.data.section_id)) continue;
    const bullets = item.data.bullets.map(clean).filter((b) => b.length > 0 && wordCount(b) <= MAX_BULLET_WORDS).slice(0, MAX_BULLETS);
    if (bullets.length === 0) continue;
    seen.add(item.data.section_id);
    bulletsBySection.push({ section_id: item.data.section_id, bullets });
  }
  if (bulletsBySection.length === 0) throw new SummaryError("summary has no usable bullets");

  const terms = new Set<string>();
  const keyTerms: Summary["key_terms"] = [];
  for (const raw of parsed.data.summary.key_terms) {
    const item = rawTerm.safeParse(raw);
    if (!item.success) continue;
    const term = clean(item.data.term);
    const meaning = clean(item.data.meaning);
    if (!term || !meaning || wordCount(term) > MAX_TERM_WORDS || wordCount(meaning) > MAX_MEANING_WORDS) continue;
    if (terms.has(term.toLowerCase())) continue;
    terms.add(term.toLowerCase());
    keyTerms.push({ term, meaning });
    if (keyTerms.length === MAX_TERMS) break;
  }
  return { bullets_by_section: bulletsBySection, key_terms: keyTerms };
}

/** What a card says as one plain line: "Front: back", or the sentence with its blank filled in. */
function cardLine(card: Card): string {
  const front = clean(card.front);
  const back = clean(card.back);
  if (card.type === "cloze" && front.includes("____")) return front.replace(/_{2,}/g, back);
  if (card.type === "qa") return back;
  return `${front.replace(/[?:.]+$/, "")}: ${back}`;
}

/** A cheat sheet written from the verified cards alone, with no AI. Used when P5 is unavailable or out of date. */
export function fallbackSummary(deck: Deck): Summary {
  const cards = verifiedCards(deck);
  const bulletsBySection = deck.sections
    .map((s) => ({
      section_id: s.id,
      bullets: cards
        .filter((c) => c.section_id === s.id)
        .slice(0, MAX_BULLETS)
        .map((c) => clipWords(cardLine(c), MAX_BULLET_WORDS)),
    }))
    .filter((s) => s.bullets.length > 0);
  const keyTerms = cards
    .filter((c) => c.type === "term" && wordCount(c.front) <= MAX_TERM_WORDS)
    .slice(0, MAX_TERMS)
    .map((c) => ({ term: clean(c.front), meaning: clipWords(c.back, MAX_MEANING_WORDS) }));
  return { bullets_by_section: bulletsBySection, key_terms: keyTerms, basis: cardsFingerprint(deck.cards) };
}

/** True when the deck's stored summary was written for the cards as they are now. The hand-written sample always is. */
export function summaryIsCurrent(deck: Deck): boolean {
  if (deck.summary.bullets_by_section.length === 0) return false;
  if (deck.meta.sample) return true;
  return deck.summary.basis === cardsFingerprint(deck.cards);
}

/** The summary to print: the stored one when it matches the cards, otherwise one written from the cards. */
export function currentSummary(deck: Deck): { summary: Summary; from: "ai" | "cards" } {
  return summaryIsCurrent(deck) ? { summary: deck.summary, from: "ai" } : { summary: fallbackSummary(deck), from: "cards" };
}

/** Sections that have at least one verified card, with those cards: what P5 is shown. */
export function summaryInputs(deck: Deck): { id: string; title: string; cards: { front: string; back: string }[] }[] {
  const cards = verifiedCards(deck);
  return deck.sections
    .map((s) => ({
      id: s.id,
      title: s.title,
      cards: cards
        .filter((c) => c.section_id === s.id)
        .slice(0, MAX_CARDS_PER_SECTION)
        .map((c) => ({ front: c.front, back: c.back })),
    }))
    .filter((s) => s.cards.length > 0);
}

type CallAI = typeof callAI;

/** P5 for the whole deck. Returns null (without calling the AI) when no card is verified. Throws if the call or answer is unusable. */
export async function buildDeckSummary(deck: Deck, call: CallAI = callAI): Promise<Summary | null> {
  const sections = summaryInputs(deck);
  if (sections.length === 0) return null;
  const { value } = await call("P5", { sections }, (json) =>
    parseSummary(
      json,
      deck.sections.filter((s) => sections.some((x) => x.id === s.id)),
    ),
  );
  return { ...value, basis: cardsFingerprint(deck.cards) };
}

export const withSummary = (deck: Deck, summary: Summary): Deck => ({ ...deck, summary });
