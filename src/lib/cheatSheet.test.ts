import { describe, expect, it } from "vitest";
import { applyLevel, buildCheatSheet, cheatSheetFileName, cheatSheetModel, docDefinition, LEVELS, renderOnePage } from "./cheatSheet";
import { cardsFingerprint } from "./summary";
import type { Card, Deck } from "../types/deck";

const card = (id: string, section_id: string, over: Partial<Card> = {}): Card => ({
  id,
  section_id,
  type: "term",
  front: `Term ${id}`,
  back: `Meaning of ${id}.`,
  say_front: "",
  say_back: "",
  source_page: 1,
  source_quote: "q",
  quote_found: true,
  in_source: true,
  edited_by_user: false,
  ...over,
});

const cards = [card("c1", "s1"), card("c2", "s1"), card("c3", "s2"), card("c4", "s2", { in_source: false })];

const deck: Deck = {
  meta: { title: "Thermo notes", source_file: "thermo.pdf", file_hash: "h", pages: 4, model: "m", created: "2026-11-12", ai_generated: true },
  sections: [
    { id: "s1", title: "Laws", summary: "", page_range: [1, 2] },
    { id: "s2", title: "Engines", summary: "", page_range: [3, 4] },
    { id: "s3", title: "Empty", summary: "", page_range: [5, 5] },
  ],
  cards,
  quiz: [],
  summary: {
    bullets_by_section: [{ section_id: "s1", bullets: ["Law one says a thing.", "Law two says another."] }],
    key_terms: [{ term: "Entropy", meaning: "Disorder." }],
    basis: cardsFingerprint(cards),
  },
};

const onePage = async () => ({ blob: new Blob(["x"]), pages: 1 });

describe("cheatSheetModel", () => {
  it("uses the summary, fills a section it lacks from the cards, and skips sections with no verified cards", () => {
    const m = cheatSheetModel(deck, deck.summary, "2026-11-12");
    expect(m.sections.map((s) => s.title)).toEqual(["Laws", "Engines"]);
    expect(m.sections[0].bullets).toEqual(["Law one says a thing.", "Law two says another."]);
    expect(m.sections[1].bullets).toEqual(["Term c3: Meaning of c3."]);
    expect(m.terms).toEqual([{ term: "Entropy", meaning: "Disorder." }]);
    expect(m.note).toContain("AI-generated");
    expect(m.footer).toContain("thermo.pdf");
    expect(m.footer).toContain("2026-11-12");
  });

  it("never puts an unverified card on the sheet", () => {
    const m = cheatSheetModel(deck, { bullets_by_section: [], key_terms: [] }, "d");
    expect(JSON.stringify(m)).not.toContain("c4");
  });

  it("labels the sample deck as hand-written", () => {
    const m = cheatSheetModel({ ...deck, meta: { ...deck.meta, ai_generated: false, sample: true } }, deck.summary, "d");
    expect(m.note).not.toContain("AI-generated");
  });
});

describe("shrinking", () => {
  it("goes in the order fewer terms, then shorter bullets, then smaller type", () => {
    const termDrops = LEVELS.findIndex((l) => l.terms === 0);
    const wordDrops = LEVELS.findIndex((l) => l.words < 18);
    const sizeDrops = LEVELS.findIndex((l) => l.size < 10);
    expect(termDrops).toBeLessThan(wordDrops);
    expect(wordDrops).toBeLessThan(sizeDrops);
    for (let i = 1; i < LEVELS.length; i++) {
      expect(LEVELS[i].terms).toBeLessThanOrEqual(LEVELS[i - 1].terms);
      expect(LEVELS[i].words).toBeLessThanOrEqual(LEVELS[i - 1].words);
      expect(LEVELS[i].size).toBeLessThanOrEqual(LEVELS[i - 1].size);
    }
  });

  it("applyLevel limits terms and clips bullets", () => {
    const model = {
      title: "t",
      note: "n",
      footer: "f",
      sections: [{ title: "S", bullets: ["one two three four five six"] }],
      terms: [
        { term: "a", meaning: "b" },
        { term: "c", meaning: "d" },
      ],
    };
    const out = applyLevel(model, { terms: 1, words: 3, size: 10 });
    expect(out.terms).toHaveLength(1);
    expect(out.sections[0].bullets).toEqual(["one two three…"]);
  });

  const model = cheatSheetModel(deck, deck.summary, "2026-11-12");

  it("stops at the first level that gives one page", async () => {
    let tried = 0;
    const render = async () => ({ blob: new Blob(["x"]), pages: ++tried < 3 ? 2 : 1 });
    const out = await renderOnePage(model, render as never);
    expect(out.level).toBe(2);
    expect(tried).toBe(3);
  });

  it("gives up with an error when even the smallest level overflows", async () => {
    await expect(renderOnePage(model, (async () => ({ blob: new Blob(["x"]), pages: 2 })) as never)).rejects.toThrow(/one page/);
  });

  it("buildCheatSheet refuses a deck with nothing verified and names the file from the title", async () => {
    const empty = { ...deck, cards: [card("c1", "s1", { in_source: false })] };
    await expect(buildCheatSheet(empty, deck.summary, "d", onePage as never)).rejects.toThrow(/verified/);
    const file = await buildCheatSheet(deck, deck.summary, "d", onePage as never);
    expect(file.fileName).toBe("thermo-notes-cheat-sheet.pdf");
    expect(file.level).toBe(0);
    expect(cheatSheetFileName("  !!  ")).toBe("notes-cheat-sheet.pdf");
  });
});

describe("docDefinition", () => {
  const model = cheatSheetModel(deck, deck.summary, "2026-11-12");

  it("is an A4 document with a language and a title, and is not marked as tagged without a structure tree", () => {
    const def = docDefinition(model, 10);
    expect(def.pageSize).toBe("A4");
    expect(def.tagged).toBeUndefined();
    expect(def.displayTitle).toBe(true);
    expect(def.language).toBe("en-US");
    expect(def.info?.title).toContain("Thermo notes");
  });

  it("leaves out the key terms table when there are none", () => {
    const withTerms = JSON.stringify(docDefinition(model, 10).content);
    const without = JSON.stringify(docDefinition({ ...model, terms: [] }, 10).content);
    expect(withTerms).toContain("Key terms");
    expect(without).not.toContain("Key terms");
  });
});
