import { beforeEach, describe, expect, it } from "vitest";
import { AiFailure, type callAI } from "./ai";
import { parseRegeneratedCard } from "./cards";
import { applyManualEdit, buildCardQuestion, editProblem, isChanged, regenerateCard, removeCard, replaceCard, replaceCardQuestions } from "./cardEdit";
import { addEdit, clearEdits, formatEdits, loadEdits } from "./editLog";
import type { Card, Deck, Question, Section } from "../types/deck";

const section: Section = { id: "s1", title: "Laws", summary: "", page_range: [1, 1] };
const page = "Entropy is a measure of the disorder of a system. The second law says entropy never decreases.";

const card = (id: string, over: Partial<Card> = {}): Card => ({
  id,
  section_id: "s1",
  type: "term",
  front: `Front ${id}`,
  back: `Back ${id}`,
  say_front: "",
  say_back: "",
  source_page: 1,
  source_quote: "measure of the disorder of a system",
  quote_found: true,
  in_source: true,
  edited_by_user: false,
  ...over,
});

const question = (id: string, card_id: string): Question => ({
  id,
  card_id,
  type: "mcq",
  prompt: `Prompt ${id}`,
  options: ["a", "b", "c", "d"],
  answer_index: 0,
  explanation: "e",
  source_page: 1,
});

const deck = (): Deck => ({
  meta: { title: "Notes", source_file: "n.pdf", file_hash: "h", pages: 1, model: "m", created: "2026-11-12", ai_generated: true },
  sections: [section],
  cards: [card("c1"), card("c2"), card("c3")],
  quiz: [question("q1", "c1"), question("q2", "c2"), question("q3", "c3")],
  summary: { bullets_by_section: [], key_terms: [] },
});

const rawNew = (over: Record<string, unknown> = {}) => ({
  card: { type: "term", front: "What is entropy?", back: "A measure of disorder.", say_front: "", say_back: "", source_page: 1, source_quote: "measure of the disorder of a system", ...over },
});

describe("editProblem and applyManualEdit", () => {
  it("rejects empty or over-long text", () => {
    expect(editProblem(" ", "x")).toMatch(/front/);
    expect(editProblem("x", "")).toMatch(/back/);
    expect(editProblem("x".repeat(201), "y")).toMatch(/too long/);
    expect(editProblem("x", "y".repeat(401))).toMatch(/too long/);
    expect(editProblem("x", "y")).toBeNull();
  });

  it("marks the card as edited, trims, refreshes spoken text, and keeps its source", () => {
    const out = applyManualEdit(card("c1", { say_back: "old spoken" }), "  New front ", "Blank is ____ here");
    expect(out.front).toBe("New front");
    expect(out.say_back).toBe("Blank is blank here");
    expect(out.edited_by_user).toBe(true);
    expect(out.source_quote).toBe("measure of the disorder of a system");
    expect(out.in_source).toBe(true);
  });

  it("detects whether the text changed", () => {
    expect(isChanged(card("c1"), "Front c1", " Back c1 ")).toBe(false);
    expect(isChanged(card("c1"), "Front c1", "different")).toBe(true);
  });
});

describe("parseRegeneratedCard", () => {
  it("keeps the id and section, checks the quote in code, and marks it edited", () => {
    const out = parseRegeneratedCard(rawNew(), card("c2"), page);
    expect(out.id).toBe("c2");
    expect(out.section_id).toBe("s1");
    expect(out.quote_found).toBe(true);
    expect(out.edited_by_user).toBe(true);
  });

  it("flags a quote that is not on the page and refuses another page or a bad shape", () => {
    const out = parseRegeneratedCard(rawNew({ source_quote: "something invented" }), card("c2"), page);
    expect(out.in_source).toBe(false);
    expect(out.check_reason).toMatch(/quote/);
    expect(() => parseRegeneratedCard(rawNew({ source_page: 2 }), card("c2"), page)).toThrow();
    expect(() => parseRegeneratedCard({ card: { front: "x" } }, card("c2"), page)).toThrow();
  });
});

describe("regenerateCard", () => {
  const fake = (p3: "ok" | "no" | "fail"): typeof callAI =>
    (async (id: string, _inputs: unknown, validate: (j: unknown) => unknown) => {
      if (id === "P6") return { value: validate(rawNew()), provider: "f", model: "f" };
      if (p3 === "fail") throw new AiFailure("unavailable");
      return { value: validate({ checks: [{ card_id: "c2", in_source: p3 === "ok", reason: "Too broad." }] }), provider: "f", model: "f" };
    }) as never;

  it("re-runs the checker on the new card", async () => {
    const ok = await regenerateCard(card("c2"), section, page, "clearer", fake("ok"));
    expect(ok.in_source).toBe(true);
    const no = await regenerateCard(card("c2"), section, page, "", fake("no"));
    expect(no.in_source).toBe(false);
    expect(no.check_reason).toBe("Too broad.");
  });

  it("flags the card when the checker cannot run, and skips the checker when the quote is missing", async () => {
    expect((await regenerateCard(card("c2"), section, page, "", fake("fail"))).in_source).toBe(false);
    let calls = 0;
    const call = (async (_id: string, _i: unknown, validate: (j: unknown) => unknown) => {
      calls++;
      return { value: validate(rawNew({ source_quote: "not on the page" })), provider: "f", model: "f" };
    }) as never;
    expect((await regenerateCard(card("c2"), section, page, "", call)).in_source).toBe(false);
    expect(calls).toBe(1);
  });

  it("passes AI failures from the rewrite itself on", async () => {
    const call = (async () => {
      throw new AiFailure("rate_limited");
    }) as never;
    await expect(regenerateCard(card("c2"), section, page, "", call)).rejects.toBeInstanceOf(AiFailure);
  });
});

describe("buildCardQuestion", () => {
  const cards = [card("c1"), card("c2"), card("c3", { in_source: false })];
  const call = (quiz: unknown[]) => (async (_id: string, _i: unknown, validate: (j: unknown) => unknown) => ({ value: validate({ quiz }), provider: "f", model: "f" })) as never;
  const q = (card_id: string, prompt: string) => ({ card_id, type: "mcq", prompt, options: ["a", "b", "c", "d"], answer_index: 1, explanation: "e" });

  it("keeps only the question about this card and gives it a stable id", async () => {
    const out = await buildCardQuestion(cards[0], section, cards, call([q("c2", "About two"), q("c1", "About one")]));
    expect(out).toHaveLength(1);
    expect(out[0].card_id).toBe("c1");
    expect(out[0].id).toBe("c1q1");
  });

  it("returns nothing for an unsupported card, a lone card, or no usable question", async () => {
    expect(await buildCardQuestion(cards[2], section, cards, call([]))).toEqual([]);
    expect(await buildCardQuestion(cards[0], section, [cards[0]], call([]))).toEqual([]);
    expect(await buildCardQuestion(cards[0], section, cards, call([q("c1", "x"), { bad: true }].slice(1)))).toEqual([]);
  });
});

describe("deck changes", () => {
  it("replaces a card in place", () => {
    const d = replaceCard(deck(), card("c2", { front: "New" }));
    expect(d.cards.map((c) => c.front)).toEqual(["Front c1", "New", "Front c3"]);
  });

  it("deleting a card removes it and its questions", () => {
    const d = removeCard(deck(), "c2");
    expect(d.cards.map((c) => c.id)).toEqual(["c1", "c3"]);
    expect(d.quiz.map((x) => x.card_id)).toEqual(["c1", "c3"]);
  });

  it("replaces the questions about one card and keeps the others", () => {
    const d = replaceCardQuestions(deck(), "c2", [question("c2q1", "c2")]);
    expect(d.quiz.map((x) => x.id).sort()).toEqual(["c2q1", "q1", "q3"]);
    expect(replaceCardQuestions(deck(), "c2", []).quiz.map((x) => x.card_id)).toEqual(["c1", "c3"]);
  });
});

describe("edit log", () => {
  beforeEach(() => {
    const store = new Map<string, string>();
    (globalThis as unknown as { localStorage: Storage }).localStorage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
      clear: () => store.clear(),
      key: () => null,
      length: 0,
    };
  });

  it("stores edits, formats them as ai-log rows without breaking the table, and clears", () => {
    addEdit({ at: "2026-11-12T10:00:00Z", deck: "Notes", card_id: "c1", action: "edit", before: { front: "A | B", back: "old" }, after: { front: "A", back: "new" } });
    addEdit({ at: "2026-11-12T10:05:00Z", deck: "Notes", card_id: "c2", action: "regenerate", before: { front: "x", back: "y" }, after: { front: "p", back: "q" }, note: "too vague" });
    addEdit({ at: "2026-11-12T10:06:00Z", deck: "Notes", card_id: "c3", action: "delete", before: { front: "gone", back: "z" } });
    const rows = formatEdits(loadEdits()).split("\n");
    expect(rows).toHaveLength(3);
    expect(rows[0]).toContain("A / B");
    expect(rows[0]).toContain("| n/a |");
    expect(rows[1]).toContain("| P6 |");
    expect(rows[1]).toContain("too vague");
    expect(rows[2]).toContain("Deleted card c3");
    rows.forEach((r) => expect(r.startsWith("| 2026-11-12 |")).toBe(true));
    clearEdits();
    expect(loadEdits()).toEqual([]);
  });

  it("survives corrupt storage", () => {
    localStorage.setItem("sd.edits.v1", "{not json");
    expect(loadEdits()).toEqual([]);
  });
});
