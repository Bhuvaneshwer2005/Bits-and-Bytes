import { describe, expect, it } from "vitest";
import sampleDeck from "../data/sample-deck.json";
import { buildQuiz, checkQuestion, QuizError, scoreQuiz, selectQuestions, shuffleQuestion } from "./quiz";
import type { Card, Deck, Question, Section } from "../types/deck";

const card = (id: string, section = "s1", page = 2): Card =>
  ({ id, section_id: section, source_page: page, in_source: true }) as Card;
const cards = [card("c1"), card("c2"), card("c3", "s2", 5)];
const byId = new Map(cards.map((c) => [c.id, c]));

const mcq = (over: Record<string, unknown> = {}) => ({
  card_id: "c1",
  type: "mcq",
  prompt: "Which law covers entropy?",
  options: ["First", "Second", "Third", "Zeroth"],
  answer_index: 1,
  explanation: "The second law is about entropy.",
  ...over,
});

describe("checkQuestion", () => {
  it("accepts a good multiple-choice question and takes the source page from the card", () => {
    const q = checkQuestion(mcq({ source_page: 99 }), byId)!;
    expect(q.source_page).toBe(2);
    expect(q.options).toHaveLength(4);
  });

  it("accepts a true/false question and normalises its options", () => {
    const q = checkQuestion(mcq({ type: "tf", options: ["true", "FALSE"], answer_index: 0, prompt: "Entropy never decreases." }), byId)!;
    expect(q.options).toEqual(["True", "False"]);
  });

  it("rejects a true/false question with other options or a bad answer index", () => {
    expect(checkQuestion(mcq({ type: "tf", options: ["Yes", "No"], answer_index: 0 }), byId)).toBeNull();
    expect(checkQuestion(mcq({ type: "tf", options: ["True", "False"], answer_index: 2 }), byId)).toBeNull();
  });

  it("accepts a cloze question only when the prompt has a blank", () => {
    expect(checkQuestion(mcq({ type: "cloze", prompt: "Entropy of an isolated system never ____." }), byId)).not.toBeNull();
    expect(checkQuestion(mcq({ type: "cloze", prompt: "Entropy never decreases." }), byId)).toBeNull();
  });

  it("rejects the wrong number of options, duplicates, long options and 'all of the above'", () => {
    expect(checkQuestion(mcq({ options: ["A", "B", "C"] }), byId)).toBeNull();
    expect(checkQuestion(mcq({ options: ["A", "a", "C", "D"] }), byId)).toBeNull();
    expect(checkQuestion(mcq({ options: ["A", "B", "C", "x".repeat(81)] }), byId)).toBeNull();
    expect(checkQuestion(mcq({ options: ["A", "B", "C", "All of the above"] }), byId)).toBeNull();
    expect(checkQuestion(mcq({ options: ["A", "B", "C", "None of the above"] }), byId)).toBeNull();
  });

  it("rejects an answer index outside the options", () => {
    expect(checkQuestion(mcq({ answer_index: 4 }), byId)).toBeNull();
    expect(checkQuestion(mcq({ answer_index: -1 }), byId)).toBeNull();
  });

  it("rejects an unknown card, a missing explanation or an over-long prompt", () => {
    expect(checkQuestion(mcq({ card_id: "nope" }), byId)).toBeNull();
    expect(checkQuestion(mcq({ explanation: " " }), byId)).toBeNull();
    expect(checkQuestion(mcq({ prompt: "x".repeat(161) }), byId)).toBeNull();
    expect(checkQuestion({ nonsense: true }, byId)).toBeNull();
  });
});

describe("buildQuiz", () => {
  it("drops bad questions, keeps good ones, and gives fresh ids", () => {
    const out = buildQuiz({ quiz: [mcq(), mcq({ options: ["A"] }), mcq({ card_id: "c2", prompt: "Another question?" })] }, cards, "s1");
    expect(out.map((q) => q.id)).toEqual(["s1q1", "s1q2"]);
  });

  it("drops a repeated question", () => {
    expect(buildQuiz({ quiz: [mcq(), mcq({ prompt: "WHICH law covers entropy?" })] }, cards, "s1")).toHaveLength(1);
  });

  it("throws only when nothing usable is left, or the shape is wrong", () => {
    expect(() => buildQuiz({ quiz: [mcq({ options: [] })] }, cards, "s1")).toThrow(QuizError);
    expect(() => buildQuiz({ nope: 1 }, cards, "s1")).toThrow(QuizError);
    expect(() => buildQuiz(null, cards, "s1")).toThrow(QuizError);
  });

  it("caps a section at 8 questions", () => {
    const many = Array.from({ length: 12 }, (_, i) => mcq({ prompt: `Question number ${i}?` }));
    expect(buildQuiz({ quiz: many }, cards, "s1")).toHaveLength(8);
  });
});

describe("shuffleQuestion", () => {
  const question = (id: string, answer: number): Question => ({
    id,
    card_id: "c1",
    type: "mcq",
    prompt: "p",
    options: ["A", "B", "C", "D"],
    answer_index: answer,
    explanation: "e",
    source_page: 1,
  });

  it("is the same for the same seed and different for another", () => {
    const a = shuffleQuestion(question("q1", 0), "seed-1");
    expect(shuffleQuestion(question("q1", 0), "seed-1")).toEqual(a);
    const orders = new Set(Array.from({ length: 20 }, (_, i) => shuffleQuestion(question("q1", 0), `seed-${i}`).options.join("")));
    expect(orders.size).toBeGreaterThan(5);
  });

  it("keeps the right answer pointing at the right text", () => {
    for (let i = 0; i < 50; i++) {
      const item = shuffleQuestion(question(`q${i}`, 2), `s${i}`);
      expect(item.options[item.answerIndex]).toBe("C");
      expect([...item.options].sort()).toEqual(["A", "B", "C", "D"]);
    }
  });

  it("does not always put the right answer in the same slot", () => {
    const slots = new Set(Array.from({ length: 60 }, (_, i) => shuffleQuestion(question(`q${i}`, 0), "fixed").answerIndex));
    expect(slots.size).toBe(4);
  });

  it("leaves true/false in its natural order", () => {
    const tf: Question = { ...question("t", 1), type: "tf", options: ["True", "False"] };
    const item = shuffleQuestion(tf, "any");
    expect(item.options).toEqual(["True", "False"]);
    expect(item.answerIndex).toBe(1);
  });
});

describe("selectQuestions", () => {
  const q = (id: string, cardId: string): Question => ({
    id,
    card_id: cardId,
    type: "tf",
    prompt: id,
    options: ["True", "False"],
    answer_index: 0,
    explanation: "e",
    source_page: 1,
  });
  const deck = { quiz: [q("q1", "c1"), q("q2", "c2"), q("q3", "c3")] } as unknown as Deck;

  it("asks only about cards that were viewed", () => {
    const items = selectQuestions(deck, ["c1", "c3"], "seed");
    expect(items.map((i) => i.question.id)).toEqual(["q1", "q3"]);
  });

  it("asks nothing when no card was viewed", () => {
    expect(selectQuestions(deck, [], "seed")).toEqual([]);
  });

  it("limits a long quiz to 20 questions, in deck order", () => {
    const big = { quiz: Array.from({ length: 30 }, (_, i) => q(`q${String(i).padStart(2, "0")}`, "c1")) } as unknown as Deck;
    const items = selectQuestions(big, ["c1"], "seed");
    expect(items).toHaveLength(20);
    const ids = items.map((i) => i.question.id);
    expect(ids).toEqual([...ids].sort());
  });
});

describe("scoreQuiz", () => {
  const sections: Section[] = [
    { id: "s1", title: "Laws", summary: "", page_range: [1, 3] },
    { id: "s2", title: "Engines", summary: "", page_range: [4, 6] },
  ];
  const tf = (id: string, cardId: string): Question => ({
    id,
    card_id: cardId,
    type: "tf",
    prompt: id,
    options: ["True", "False"],
    answer_index: 0,
    explanation: "e",
    source_page: 1,
  });
  const items = ["q1", "q2", "q3", "q4"].map((id, i) => shuffleQuestion(tf(id, ["c1", "c2", "c3", "c3"][i]), "s"));

  it("counts right answers, lists missed cards once, and finds the weakest section", () => {
    const r = scoreQuiz(items, { q1: 0, q2: 0, q3: 1, q4: 1 }, cards, sections, "2026-11-12");
    expect(r.score).toBe(2);
    expect(r.total).toBe(4);
    expect(r.missed_card_ids).toEqual(["c3"]);
    expect(r.weakest_section_id).toBe("s2");
    expect(r.by_section.map((s) => `${s.section_id}:${s.correct}/${s.total}`)).toEqual(["s1:2/2", "s2:0/2"]);
    expect(r.date).toBe("2026-11-12");
  });

  it("reports no weakest section when everything is right", () => {
    const r = scoreQuiz(items, { q1: 0, q2: 0, q3: 0, q4: 0 }, cards, sections, "2026-11-12");
    expect(r.score).toBe(4);
    expect(r.missed_card_ids).toEqual([]);
    expect(r.weakest_section_id).toBeNull();
  });

  it("counts an unanswered question as wrong", () => {
    expect(scoreQuiz(items, {}, cards, sections, "2026-11-12").score).toBe(0);
  });
});

describe("the bundled sample deck's quiz", () => {
  const deck = sampleDeck as unknown as Deck;
  const byCard = new Map(deck.cards.map((c) => [c.id, c]));

  it("has a valid question for every supported card and none for the flagged one", () => {
    const supported = deck.cards.filter((c) => c.in_source).map((c) => c.id);
    const asked = new Set(deck.quiz.map((q) => q.card_id));
    for (const id of supported) expect(asked.has(id), `no question for ${id}`).toBe(true);
    for (const c of deck.cards.filter((c) => !c.in_source)) expect(asked.has(c.id)).toBe(false);
  });

  it("passes the same checks as AI-written questions, and cites the card's page", () => {
    for (const q of deck.quiz) {
      const checked = checkQuestion(q, byCard);
      expect(checked, `question ${q.id} fails validation`).not.toBeNull();
      expect(q.source_page).toBe(byCard.get(q.card_id)!.source_page);
    }
  });

  it("has unique question ids", () => {
    const ids = deck.quiz.map((q) => q.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
