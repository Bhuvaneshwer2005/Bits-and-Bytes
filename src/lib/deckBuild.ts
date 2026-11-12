import { AiFailure, callAI } from "./ai";
import { applyChecks, buildCards, markUnchecked, parseChecks } from "./cards";
import type { Card, Deck, Section } from "../types/deck";

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
  try {
    const usedPages = [...new Set(cards.map((c) => c.source_page))].sort((a, b) => a - b);
    const { value: checks } = await call(
      "P3",
      {
        cards: cards.map((c) => ({ id: c.id, front: c.front, back: c.back, source_page: c.source_page, source_quote: c.source_quote })),
        pages: usedPages.map((page) => ({ page, text: pageTexts.get(page) ?? "" })),
      },
      parseChecks,
    );
    return { cards: applyChecks(cards, checks), unchecked: false };
  } catch (e) {
    if (e instanceof AiFailure) return { cards: markUnchecked(cards), unchecked: true };
    throw e;
  }
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
export function assembleDeck(input: BuildInput, cardsBySection: Map<string, Card[]>): Deck {
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
    quiz: [],
    summary: { bullets_by_section: [], key_terms: [] },
  };
}
