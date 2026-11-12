import { describe, expect, it } from "vitest";
import { AiFailure } from "./ai";
import {
  buildDeckSummary,
  cardsFingerprint,
  clipWords,
  currentSummary,
  fallbackSummary,
  parseSummary,
  summaryInputs,
  summaryIsCurrent,
  SummaryError,
  verifiedCards,
} from "./summary";
import type { Card, Deck, Section } from "../types/deck";

const sections: Section[] = [
  { id: "s1", title: "Laws", summary: "", page_range: [1, 2] },
  { id: "s2", title: "Engines", summary: "", page_range: [3, 4] },
];

const card = (id: string, section_id: string, over: Partial<Card> = {}): Card => ({
  id,
  section_id,
  type: "term",
  front: `Front ${id}`,
  back: `Back of ${id}.`,
  say_front: "",
  say_back: "",
  source_page: 1,
  source_quote: "q",
  quote_found: true,
  in_source: true,
  edited_by_user: false,
  ...over,
});

const deck = (cards: Card[], over: Partial<Deck> = {}): Deck => ({
  meta: { title: "Notes", source_file: "notes.pdf", file_hash: "h", pages: 4, model: "m", created: "2026-11-12", ai_generated: true },
  sections,
  cards,
  quiz: [],
  summary: { bullets_by_section: [], key_terms: [] },
  ...over,
});

const words = (n: number) => Array.from({ length: n }, (_, i) => `w${i}`).join(" ");

describe("parseSummary", () => {
  it("keeps a valid summary", () => {
    const out = parseSummary(
      { summary: { bullets_by_section: [{ section_id: "s1", bullets: ["One.", "Two."] }], key_terms: [{ term: "Entropy", meaning: "Disorder." }] } },
      sections,
    );
    expect(out.bullets_by_section).toEqual([{ section_id: "s1", bullets: ["One.", "Two."] }]);
    expect(out.key_terms).toEqual([{ term: "Entropy", meaning: "Disorder." }]);
  });

  it("caps bullets at 4 and terms at 10, and drops long bullets and long meanings", () => {
    const out = parseSummary(
      {
        summary: {
          bullets_by_section: [{ section_id: "s1", bullets: ["a", "b", words(19), "c", "d", "e"] }],
          key_terms: [
            ...Array.from({ length: 12 }, (_, i) => ({ term: `Term ${i}`, meaning: "short" })),
            { term: "Long", meaning: words(13) },
          ],
        },
      },
      sections,
    );
    expect(out.bullets_by_section[0].bullets).toEqual(["a", "b", "c", "d"]);
    expect(out.key_terms).toHaveLength(10);
    expect(out.key_terms.some((t) => t.term === "Long")).toBe(false);
  });

  it("keeps a bullet of exactly 18 words and drops one of 19", () => {
    const out = parseSummary({ summary: { bullets_by_section: [{ section_id: "s1", bullets: [words(18), words(19)] }], key_terms: [] } }, sections);
    expect(out.bullets_by_section[0].bullets).toEqual([words(18)]);
  });

  it("ignores unknown or repeated sections and repeated terms", () => {
    const out = parseSummary(
      {
        summary: {
          bullets_by_section: [
            { section_id: "zz", bullets: ["x"] },
            { section_id: "s1", bullets: ["first"] },
            { section_id: "s1", bullets: ["second"] },
          ],
          key_terms: [
            { term: "Entropy", meaning: "a" },
            { term: "entropy", meaning: "b" },
          ],
        },
      },
      sections,
    );
    expect(out.bullets_by_section).toEqual([{ section_id: "s1", bullets: ["first"] }]);
    expect(out.key_terms).toHaveLength(1);
  });

  it("throws when nothing usable is left or the shape is wrong", () => {
    expect(() => parseSummary({ summary: { bullets_by_section: [], key_terms: [] } }, sections)).toThrow(SummaryError);
    expect(() => parseSummary({ summary: { bullets_by_section: [{ section_id: "s1", bullets: [words(30)] }], key_terms: [] } }, sections)).toThrow(
      SummaryError,
    );
    expect(() => parseSummary({ nope: 1 }, sections)).toThrow(SummaryError);
    expect(() => parseSummary("text", sections)).toThrow(SummaryError);
  });
});

describe("clipWords", () => {
  it("leaves short text alone and marks a cut", () => {
    expect(clipWords("  a   b  ", 5)).toBe("a b");
    expect(clipWords("one two three four, five", 4)).toBe("one two three four…");
  });
});

describe("fingerprint and currency", () => {
  it("changes when a verified card is edited or removed, but not when a flagged card changes", () => {
    const base = [card("c1", "s1"), card("c2", "s1"), card("c3", "s2", { in_source: false })];
    const f = cardsFingerprint(base);
    expect(cardsFingerprint([...base])).toBe(f);
    expect(cardsFingerprint([{ ...base[0], back: "changed" }, base[1], base[2]])).not.toBe(f);
    expect(cardsFingerprint([base[0], base[2]])).not.toBe(f);
    expect(cardsFingerprint([base[0], base[1], { ...base[2], back: "other" }])).toBe(f);
  });

  it("a stored summary is current only while the cards match", () => {
    const cards = [card("c1", "s1")];
    const stored = deck(cards, { summary: { bullets_by_section: [{ section_id: "s1", bullets: ["x"] }], key_terms: [], basis: cardsFingerprint(cards) } });
    expect(summaryIsCurrent(stored)).toBe(true);
    expect(summaryIsCurrent({ ...stored, cards: [card("c1", "s1", { back: "edited" })] })).toBe(false);
    expect(summaryIsCurrent(deck(cards))).toBe(false);
  });

  it("the hand-written sample deck's summary is always current", () => {
    const d = deck([card("c1", "s1")], {
      meta: { ...deck([]).meta, sample: true },
      summary: { bullets_by_section: [{ section_id: "s1", bullets: ["x"] }], key_terms: [] },
    });
    expect(summaryIsCurrent(d)).toBe(true);
    expect(currentSummary(d).from).toBe("ai");
  });

  it("falls back to the cards when the stored summary is stale", () => {
    const d = deck([card("c1", "s1", { back: "New back." })], {
      summary: { bullets_by_section: [{ section_id: "s1", bullets: ["old"] }], key_terms: [], basis: "00000000" },
    });
    const out = currentSummary(d);
    expect(out.from).toBe("cards");
    expect(out.summary.bullets_by_section[0].bullets[0]).toContain("New back.");
  });
});

describe("fallbackSummary", () => {
  it("uses verified cards only, writes a line per card type, and caps counts", () => {
    const cards = [
      card("c1", "s1", { front: "Entropy", back: "Disorder of a system." }),
      card("c2", "s1", { type: "qa", front: "What is X?", back: "X is a thing." }),
      card("c3", "s1", { type: "cloze", front: "Water boils at ____ degrees.", back: "100" }),
      card("c4", "s1", { in_source: false, front: "Hidden", back: "Not verified." }),
      ...Array.from({ length: 6 }, (_, i) => card(`m${i}`, "s2", { front: `Term ${i}`, back: words(20) })),
    ];
    const out = fallbackSummary(deck(cards));
    expect(out.bullets_by_section[0].bullets).toEqual(["Entropy: Disorder of a system.", "X is a thing.", "Water boils at 100 degrees."]);
    expect(JSON.stringify(out)).not.toContain("Not verified");
    expect(out.bullets_by_section[1].bullets).toHaveLength(4);
    expect(out.bullets_by_section[1].bullets.every((b) => b.replace("…", "").split(" ").length <= 18)).toBe(true);
    expect(out.key_terms.length).toBeLessThanOrEqual(10);
    expect(out.key_terms.find((t) => t.term === "Entropy")).toBeDefined();
    expect(out.key_terms.every((t) => t.meaning.replace("…", "").split(" ").length <= 12)).toBe(true);
  });

  it("leaves out sections with no verified cards", () => {
    const out = fallbackSummary(deck([card("c1", "s1"), card("c2", "s2", { in_source: false })]));
    expect(out.bullets_by_section.map((s) => s.section_id)).toEqual(["s1"]);
  });
});

describe("buildDeckSummary", () => {
  const cards = [card("c1", "s1"), card("c2", "s2"), card("c3", "s2", { in_source: false })];

  it("sends only verified cards, grouped by section", () => {
    const sent = summaryInputs(deck(cards));
    expect(sent.map((s) => [s.id, s.cards.length])).toEqual([
      ["s1", 1],
      ["s2", 1],
    ]);
    expect(verifiedCards(deck(cards))).toHaveLength(2);
  });

  it("returns the validated summary stamped with the cards' fingerprint", async () => {
    const call = (async (id: string, _inputs: unknown, validate: (j: unknown) => unknown) => {
      expect(id).toBe("P5");
      return { value: validate({ summary: { bullets_by_section: [{ section_id: "s1", bullets: ["ok"] }], key_terms: [] } }), provider: "f", model: "f" };
    }) as never;
    const out = await buildDeckSummary(deck(cards), call);
    expect(out?.basis).toBe(cardsFingerprint(cards));
    expect(out?.bullets_by_section[0].bullets).toEqual(["ok"]);
  });

  it("does not call the AI when no card is verified, and passes failures on", async () => {
    let calls = 0;
    const call = (async () => {
      calls++;
      throw new AiFailure("unavailable");
    }) as never;
    expect(await buildDeckSummary(deck([card("c1", "s1", { in_source: false })]), call)).toBeNull();
    expect(calls).toBe(0);
    await expect(buildDeckSummary(deck(cards), call)).rejects.toBeInstanceOf(AiFailure);
  });
});
