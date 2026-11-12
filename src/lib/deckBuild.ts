import { AiFailure, callAI } from "./ai";
import { applyChecks, buildCards, contextAround, markUnchecked, parseChecks } from "./cards";
import { buildQuiz } from "./quiz";
import type { Card, Deck, Question, Section } from "../types/deck";

/** How many sections are built at the same time. Small, to stay inside free per-minute limits. */
export const SECTION_CONCURRENCY = 2;

export interface BuildInput {
  fileName: string;
  hash: string;
  from: number;
  to: number;
  totalPages: number;
  model: string;
  sections: Section[];
  /** Text of every page in [from, to], keyed by page number. */
  pageTexts: Map<number, string>;
}

export interface SectionResult {
  cards: Card[];
  /** True when the grounding check could not run and every card was flagged instead. */
  unchecked: boolean;
}

/** About three cards per page, between 6 and 12. */
export function cardTarget(pageCount: number): number {
  return Math.min(12, Math.max(6, pageCount * 3));
}

export function titleFromFileName(fileName: string): string {
  const base = fileName.replace(/\.pdf$/i, "").replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
  return base || "Untitled notes";
}

type CallAI = typeof callAI;

/** P2 (cards) then P3 (grounding check) for one section. Throws if the cards step fails; a failed check only flags. */
export async function buildSection(
  section: Section,
  pageTexts: Map<number, string>,
  onStage: (stage: "writing" | "checking") => void,
  call: CallAI = callAI,
): Promise<SectionResult> {
  const [from, to] = section.page_range;
  const pages = Array.from({ length: to - from + 1 }, (_, i) => ({ page: from + i, text: pageTexts.get(from + i) ?? "" }));

  onStage("writing");
  const { value: cards } = await call(
    "P2",
    { section: { id: section.id, title: section.title }, pages, count: cardTarget(pages.length) },
    (json) => buildCards(json, section, pageTexts),
  );

  onStage("checking");
  // Cards whose quote isn't on the page are already flagged by code, so only the rest need the AI.
  const toCheck = cards.filter((c) => c.quote_found);
  if (toCheck.length === 0) return { cards: applyChecks(cards, new Map()), unchecked: false };
  try {
    const { value: checks } = await call(
      "P3",
      {
        cards: toCheck.map((c) => ({
          id: c.id,
          front: c.front,
          back: c.back,
          source_page: c.source_page,
          source_quote: c.source_quote,
          context: contextAround(c.source_quote, pageTexts.get(c.source_page) ?? ""),
        })),
      },
      parseChecks,
    );
    return { cards: applyChecks(cards, checks), unchecked: false };
  } catch (e) {
    if (e instanceof AiFailure) return { cards: markUnchecked(cards), unchecked: true };
    throw e;
  }
}

/** About one question for every two cards, between 3 and 6, and never more than the cards available. */
export function quizTarget(cardCount: number): number {
  return Math.min(cardCount, Math.min(6, Math.max(3, Math.ceil(cardCount / 2))));
}

/**
 * P4 for one section, from the cards the grounding check passed. Returns no questions (without calling the AI)
 * when fewer than two cards qualify. Throws if the AI call or its answer is unusable.
 */
export async function buildSectionQuiz(section: Section, cards: Card[], call: CallAI = callAI): Promise<Question[]> {
  const usable = cards.filter((c) => c.in_source);
  if (usable.length < 2) return [];
  const { value } = await call(
    "P4",
    {
      section: { id: section.id, title: section.title },
      cards: usable.map((c) => ({ id: c.id, front: c.front, back: c.back, source_page: c.source_page })),
      count: quizTarget(usable.length),
    },
    (json) => buildQuiz(json, usable, section.id),
  );
  return value;
}

/** Replaces one section's questions in a deck and keeps the questions in section order. */
export function withSectionQuiz(deck: Deck, sectionId: string, questions: Question[]): Deck {
  const sectionCards = new Set(deck.cards.filter((c) => c.section_id === sectionId).map((c) => c.id));
  const cardSection = new Map(deck.cards.map((c) => [c.id, c.section_id]));
  const order = new Map(deck.sections.map((s, i) => [s.id, i]));
  const rank = (q: Question) => order.get(cardSection.get(q.card_id) ?? "") ?? 99;
  const quiz = [...deck.quiz.filter((q) => !sectionCards.has(q.card_id)), ...questions].sort((a, b) => rank(a) - rank(b));
  return { ...deck, quiz };
}

/** Runs `worker` over `items` with at most `limit` running at once. Workers must handle their own errors. */
export async function pool<T>(items: T[], limit: number, worker: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const item = items[next++];
      await worker(item);
    }
  });
  await Promise.all(runners);
}

/** Builds the deck from whichever sections are ready, in section order. Quiz and summary come in later steps. */
export function assembleDeck(input: BuildInput, cardsBySection: Map<string, Card[]>, quizBySection: Map<string, Question[]> = new Map()): Deck {
  const readySections = input.sections.filter((s) => cardsBySection.has(s.id));
  return {
    meta: {
      title: titleFromFileName(input.fileName),
      source_file: input.fileName,
      file_hash: input.hash,
      pages: input.totalPages,
      model: input.model,
      created: new Date().toISOString(),
      ai_generated: true,
    },
    sections: readySections,
    cards: readySections.flatMap((s) => cardsBySection.get(s.id) ?? []),
    quiz: readySections.flatMap((s) => quizBySection.get(s.id) ?? []),
    summary: { bullets_by_section: [], key_terms: [] },
  };
}
