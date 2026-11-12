import { describe, expect, it } from "vitest";
import { AiFailure, callAI } from "./ai";
import { assembleDeck, buildSection, buildSectionQuiz, cardTarget, pool, quizTarget, titleFromFileName, withSectionQuiz, type BuildInput } from "./deckBuild";
import type { Card, Deck, Question, Section } from "../types/deck";

const section: Section = { id: "s1", title: "Laws", summary: "", page_range: [1, 2] };
const pageTexts = new Map([
  [1, "Zeroth law says two systems in equilibrium with a third are in equilibrium with each other."],
  [2, "The entropy of an isolated system never decreases. Energy cannot be created or destroyed."],
]);

const rawCards = {
  cards: [
    { type: "term", front: "Q1", back: "A1", say_front: "Q1", say_back: "A1", source_page: 1, source_quote: "two systems in equilibrium with a third" },
    { type: "term", front: "Q2", back: "A2", say_front: "Q2", say_back: "A2", source_page: 2, source_quote: "entropy of an isolated system never decreases" },
    { type: "qa", front: "Q3", back: "A3", say_front: "Q3", say_back: "A3", source_page: 2, source_quote: "Energy cannot be created or destroyed" },
  ],
};

/** A fake callAI that answers P2 and P3 from fixed JSON and runs the real validators. */
function fakeCall(p3: "ok" | "fail" | "partial"): typeof callAI {
  return (async (promptId: string, _inputs: unknown, validate: (j: unknown) => unknown) => {
    if (promptId === "P2") return { value: validate(rawCards), provider: "fake", model: "fake" };
    if (p3 === "fail") throw new AiFailure("unavailable");
    const checks =
      p3 === "ok"
        ? ["s1c1", "s1c2", "s1c3"].map((id) => ({ card_id: id, in_source: true }))
        : [{ card_id: "s1c1", in_source: true }, { card_id: "s1c2", in_source: false, reason: "Too broad." }];
    return { value: validate({ checks }), provider: "fake", model: "fake" };
  }) as typeof callAI;
}

describe("buildSection", () => {
  it("writes cards, checks them, and reports each stage in order", async () => {
    const stages: string[] = [];
    const result = await buildSection(section, pageTexts, (s) => stages.push(s), fakeCall("ok"));
    expect(stages).toEqual(["writing", "checking"]);
    expect(result.unchecked).toBe(false);
    expect(result.cards).toHaveLength(3);
    expect(result.cards.every((c) => c.in_source)).toBe(true);
  });

  it("sends only cards whose quote was found, each with a context window instead of whole pages", async () => {
    let p3Inputs: { cards: { id: string; context: string }[]; pages?: unknown } | null = null;
    const withBadQuote = {
      cards: [...rawCards.cards, { type: "term", front: "Q4", back: "A4", say_front: "", say_back: "", source_page: 1, source_quote: "invented sentence" }],
    };
    const call = (async (promptId: string, inputs: unknown, validate: (j: unknown) => unknown) => {
      if (promptId === "P2") return { value: validate(withBadQuote), provider: "f", model: "f" };
      p3Inputs = inputs as typeof p3Inputs;
      const checks = ["s1c1", "s1c2", "s1c3"].map((id) => ({ card_id: id, in_source: true }));
      return { value: validate({ checks }), provider: "f", model: "f" };
    }) as typeof callAI;
    const { cards } = await buildSection(section, pageTexts, () => {}, call);
    expect(p3Inputs!.cards.map((c) => c.id)).toEqual(["s1c1", "s1c2", "s1c3"]);
    expect(p3Inputs!.pages).toBeUndefined();
    expect(p3Inputs!.cards[0].context).toContain("equilibrium");
    expect(cards[3].in_source).toBe(false); // the invented quote never reaches the AI and stays flagged
  });

  it("flags cards the checker rejected or skipped", async () => {
    const { cards } = await buildSection(section, pageTexts, () => {}, fakeCall("partial"));
    expect(cards.map((c) => c.in_source)).toEqual([true, false, false]);
  });

  it("still returns the cards, all flagged, when the checker fails", async () => {
    const result = await buildSection(section, pageTexts, () => {}, fakeCall("fail"));
    expect(result.unchecked).toBe(true);
    expect(result.cards).toHaveLength(3);
    expect(result.cards.every((c) => !c.in_source)).toBe(true);
  });

  it("throws when the card step itself fails", async () => {
    const failing = (async () => {
      throw new AiFailure("rate_limited");
    }) as unknown as typeof callAI;
    await expect(buildSection(section, pageTexts, () => {}, failing)).rejects.toBeInstanceOf(AiFailure);
  });
});

describe("pool", () => {
  it("never runs more than the limit at once and finishes everything", async () => {
    let running = 0;
    let peak = 0;
    const seen: number[] = [];
    await pool([1, 2, 3, 4, 5, 6], 2, async (n) => {
      running++;
      peak = Math.max(peak, running);
      await new Promise((r) => setTimeout(r, 5));
      seen.push(n);
      running--;
    });
    expect(peak).toBeLessThanOrEqual(2);
    expect(seen.sort()).toEqual([1, 2, 3, 4, 5, 6]);
  });
});

describe("helpers", () => {
  it("scales card count with page count between 6 and 12", () => {
    expect(cardTarget(1)).toBe(6);
    expect(cardTarget(3)).toBe(9);
    expect(cardTarget(10)).toBe(12);
  });
  it("makes a readable title from a file name", () => {
    expect(titleFromFileName("my_notes-ch3.PDF")).toBe("my notes ch3");
    expect(titleFromFileName(".pdf")).toBe("Untitled notes");
  });
  it("assembles a deck from only the sections that are ready, in order", () => {
    const sections: Section[] = [section, { id: "s2", title: "More", summary: "", page_range: [3, 3] }];
    const input: BuildInput = { fileName: "n.pdf", hash: "h", from: 1, to: 3, totalPages: 3, model: "m", sections, pageTexts };
    const card = { id: "s2c1", section_id: "s2" } as Card;
    const deck = assembleDeck(input, new Map([["s2", [card]]]));
    expect(deck.sections.map((s) => s.id)).toEqual(["s2"]);
    expect(deck.cards).toEqual([card]);
    expect(deck.meta.ai_generated).toBe(true);
  });
});

describe("quiz building", () => {
  const supported = (id: string, ok = true) => ({ id, section_id: "s1", front: `Q ${id}`, back: `A ${id}`, source_page: 1, in_source: ok }) as Card;
  const goodQuiz = (ids: string[]) => ({
    quiz: ids.map((id, i) => ({
      card_id: id,
      type: "mcq",
      prompt: `Question ${i}?`,
      options: ["A", "B", "C", "D"],
      answer_index: i % 4,
      explanation: "Because.",
    })),
  });

  it("scales the question count with the cards, between 3 and 6 and never above the card count", () => {
    expect(quizTarget(2)).toBe(2);
    expect(quizTarget(4)).toBe(3);
    expect(quizTarget(8)).toBe(4);
    expect(quizTarget(12)).toBe(6);
  });

  it("asks the AI only about supported cards and returns validated questions", async () => {
    let sent: { cards: { id: string }[]; count: number } | null = null;
    const call = (async (_id: string, inputs: unknown, validate: (j: unknown) => unknown) => {
      sent = inputs as typeof sent;
      return { value: validate(goodQuiz(["c1", "c2"])), provider: "f", model: "f" };
    }) as unknown as typeof callAI;
    const qs = await buildSectionQuiz(section, [supported("c1"), supported("c2"), supported("c3", false)], call);
    expect(sent!.cards.map((c) => c.id)).toEqual(["c1", "c2"]);
    expect(qs.map((q) => q.id)).toEqual(["s1q1", "s1q2"]);
  });

  it("does not call the AI when fewer than two cards are supported", async () => {
    let called = false;
    const call = (async () => {
      called = true;
    }) as unknown as typeof callAI;
    expect(await buildSectionQuiz(section, [supported("c1"), supported("c2", false)], call)).toEqual([]);
    expect(called).toBe(false);
  });

  it("throws when the AI fails, so the caller can mark the quiz as failed", async () => {
    const call = (async () => {
      throw new AiFailure("unavailable");
    }) as unknown as typeof callAI;
    await expect(buildSectionQuiz(section, [supported("c1"), supported("c2")], call)).rejects.toBeInstanceOf(AiFailure);
  });

  it("replaces one section's questions and keeps section order", () => {
    const sections: Section[] = [section, { id: "s2", title: "More", summary: "", page_range: [3, 3] }];
    const cards = [supported("c1"), { ...supported("c2"), section_id: "s2" } as Card];
    const q = (id: string, cardId: string) => ({ id, card_id: cardId }) as Question;
    const deck = { sections, cards, quiz: [q("s2q1", "c2"), q("s1q1", "c1")] } as unknown as Deck;
    const out = withSectionQuiz(deck, "s1", [q("s1q1", "c1"), q("s1q2", "c1")]);
    expect(out.quiz.map((x) => x.id)).toEqual(["s1q1", "s1q2", "s2q1"]);
    const cleared = withSectionQuiz(deck, "s2", []);
    expect(cleared.quiz.map((x) => x.id)).toEqual(["s1q1"]);
  });

  it("assembles the quiz of the ready sections into the deck", () => {
    const input: BuildInput = { fileName: "n.pdf", hash: "h", from: 1, to: 2, totalPages: 2, model: "m", sections: [section], pageTexts };
    const q = { id: "s1q1" } as Question;
    const deck = assembleDeck(input, new Map([["s1", [supported("c1")]]]), new Map([["s1", [q]]]));
    expect(deck.quiz).toEqual([q]);
  });
});
