import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import sampleDeck from "./sample-deck.json";
import pages from "./sample-pages.json";
import { quoteInPage } from "../lib/cards";
import { checkQuestion } from "../lib/quiz";
import { cardsFingerprint, fallbackSummary, summaryIsCurrent, wordCount } from "../lib/summary";
import { buildCheatSheet } from "../lib/cheatSheet";
import type { Deck } from "../types/deck";

const deck = sampleDeck as unknown as Deck;

describe("the bundled demo deck", () => {
  it("is about 25 cards over two sections, with a pre-written quiz", () => {
    expect(deck.cards.length).toBeGreaterThanOrEqual(24);
    expect(deck.sections).toHaveLength(2);
    expect(deck.quiz.length).toBeGreaterThanOrEqual(20);
  });

  it("every source quote really appears on its page of the sample PDF text", () => {
    for (const c of deck.cards) expect(quoteInPage(c.source_quote, pages[c.source_page - 1]), `${c.id}: ${c.source_quote}`).toBe(true);
  });

  it("every card sits inside its section's page range and has a unique id", () => {
    const ids = new Set(deck.cards.map((c) => c.id));
    expect(ids.size).toBe(deck.cards.length);
    for (const c of deck.cards) {
      const s = deck.sections.find((x) => x.id === c.section_id)!;
      expect(c.source_page).toBeGreaterThanOrEqual(s.page_range[0]);
      expect(c.source_page).toBeLessThanOrEqual(s.page_range[1]);
    }
  });

  it("keeps exactly one flagged card to show the check-this flag", () => {
    expect(deck.cards.filter((c) => !c.in_source).map((c) => c.id)).toEqual(["c12"]);
  });

  it("every question passes the same checks as AI questions, and every supported card has one", () => {
    const byId = new Map(deck.cards.map((c) => [c.id, c]));
    for (const q of deck.quiz) expect(checkQuestion(q, byId), q.id).not.toBeNull();
    const asked = new Set(deck.quiz.map((q) => q.card_id));
    for (const c of deck.cards.filter((x) => x.in_source)) expect(asked.has(c.id), c.id).toBe(true);
    expect(new Set(deck.quiz.map((q) => q.id)).size).toBe(deck.quiz.length);
  });

  it("has a cheat-sheet summary that obeys the P5 limits and counts as current", () => {
    expect(summaryIsCurrent(deck)).toBe(true);
    for (const s of deck.summary.bullets_by_section) {
      expect(s.bullets.length).toBeLessThanOrEqual(4);
      for (const b of s.bullets) expect(wordCount(b)).toBeLessThanOrEqual(18);
    }
    expect(deck.summary.key_terms.length).toBeLessThanOrEqual(10);
    for (const t of deck.summary.key_terms) expect(wordCount(t.meaning)).toBeLessThanOrEqual(12);
    expect(fallbackSummary(deck).basis).toBe(cardsFingerprint(deck.cards));
  });

  it("builds a cheat sheet from the summary (renderer stubbed to one page)", async () => {
    const file = await buildCheatSheet(deck, deck.summary, "2026-11-12", (async () => ({ blob: new Blob(["x"]), pages: 1 })) as never);
    expect(file.fileName).toContain("cheat-sheet");
  });
});

describe("the sample PDF file", () => {
  it("is a real PDF with six pages", () => {
    const bytes = readFileSync("public/sample-thermodynamics-notes.pdf").toString("latin1");
    expect(bytes.startsWith("%PDF-")).toBe(true);
    expect(bytes).toContain("/Count 6");
    expect(pages).toHaveLength(6);
  });
});
