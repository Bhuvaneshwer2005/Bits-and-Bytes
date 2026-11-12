import { describe, expect, it } from "vitest";
import { applyChecks, buildCards, CardsError, markUnchecked, normalizeForMatch, parseChecks, quoteInPage } from "./cards";
import type { Section } from "../types/deck";

const section: Section = { id: "s1", title: "Laws", summary: "", page_range: [1, 2] };
const pageTexts = new Map([
  [1, "The zeroth law: if two systems are each in thermal equilibrium with a third, they are in equilibrium with each other."],
  [2, "The entropy of an isolated system never decreases. Energy cannot be created or destroyed."],
]);

const raw = (over: Partial<Record<string, unknown>> = {}) => ({
  type: "term",
  front: "Second law",
  back: "Entropy of an isolated system never decreases.",
  say_front: "What is the second law?",
  say_back: "The entropy of an isolated system never decreases.",
  source_page: 2,
  source_quote: "The entropy of an isolated system never decreases",
  ...over,
});

describe("quote check", () => {
  it("ignores case, punctuation and spacing", () => {
    expect(quoteInPage("the ZEROTH   law if two systems", pageTexts.get(1)!)).toBe(true);
  });
  it("fails when the quote is not on that page", () => {
    expect(quoteInPage("Energy cannot be created", pageTexts.get(1)!)).toBe(false);
  });
  it("requires every part of a quote with an ellipsis", () => {
    expect(quoteInPage("entropy of an isolated system ... never decreases", pageTexts.get(2)!)).toBe(true);
    expect(quoteInPage("entropy of an isolated system ... is always zero", pageTexts.get(2)!)).toBe(false);
  });
  it("rejects an empty or trivial quote", () => {
    expect(quoteInPage("", pageTexts.get(2)!)).toBe(false);
    expect(quoteInPage("...", pageTexts.get(2)!)).toBe(false);
  });
  it("normalises text for matching", () => {
    expect(normalizeForMatch("  Hello,   World!! ")).toBe("hello world");
  });
});

describe("buildCards", () => {
  const three = [raw(), raw({ front: "A", source_page: 1, source_quote: "if two systems are each in thermal equilibrium" }), raw({ front: "B" })];

  it("gives fresh ids, forces the section id and sets quote_found", () => {
    const cards = buildCards({ cards: three }, section, pageTexts);
    expect(cards.map((c) => c.id)).toEqual(["s1c1", "s1c2", "s1c3"]);
    expect(cards.every((c) => c.section_id === "s1")).toBe(true);
    expect(cards.every((c) => c.quote_found && c.in_source)).toBe(true);
  });

  it("flags a card whose quote is not on the page, and never marks it in_source", () => {
    const cards = buildCards({ cards: [...three, raw({ front: "Bad", source_quote: "real engines always fall short" })] }, section, pageTexts);
    const bad = cards.find((c) => c.front === "Bad")!;
    expect(bad.quote_found).toBe(false);
    expect(bad.in_source).toBe(false);
    expect(bad.check_reason).toBeTruthy();
  });

  it("drops cards that point outside the section", () => {
    const cards = buildCards({ cards: [...three, raw({ front: "Far", source_page: 9 })] }, section, pageTexts);
    expect(cards.some((c) => c.front === "Far")).toBe(false);
  });

  it("caps a section at 12 cards", () => {
    const many = Array.from({ length: 16 }, (_, i) => raw({ front: `Q${i}` }));
    expect(buildCards({ cards: many }, section, pageTexts)).toHaveLength(12);
  });

  it("throws when too few usable cards remain or the shape is wrong", () => {
    expect(() => buildCards({ cards: [raw(), raw()] }, section, pageTexts)).toThrow(CardsError);
    expect(() => buildCards({ cards: [{ front: "x" }] }, section, pageTexts)).toThrow(CardsError);
    expect(() => buildCards(null, section, pageTexts)).toThrow(CardsError);
    expect(() => buildCards({ cards: [raw({ type: "essay" }), raw(), raw()] }, section, pageTexts)).toThrow(CardsError);
  });
});

describe("grounding check", () => {
  const cards = buildCards({ cards: [raw(), raw({ front: "B" }), raw({ front: "C", source_quote: "not on the page at all" })] }, section, pageTexts);

  it("keeps a card in_source only when the quote was found and the checker agreed", () => {
    const checks = parseChecks({
      checks: [
        { card_id: "s1c1", in_source: true },
        { card_id: "s1c2", in_source: false, reason: "Adds an example the page lacks." },
        { card_id: "s1c3", in_source: true },
      ],
    });
    const out = applyChecks(cards, checks);
    expect(out[0].in_source).toBe(true);
    expect(out[1].in_source).toBe(false);
    expect(out[1].check_reason).toBe("Adds an example the page lacks.");
    expect(out[2].in_source).toBe(false); // the checker said yes, but the quote was not on the page
  });

  it("flags a card the checker skipped", () => {
    const out = applyChecks(cards, parseChecks({ checks: [{ card_id: "s1c1", in_source: true }] }));
    expect(out[1].in_source).toBe(false);
    expect(out[1].check_reason).toContain("did not review");
  });

  it("flags every card when the checker could not run", () => {
    const out = markUnchecked(cards);
    expect(out.every((c) => !c.in_source)).toBe(true);
    expect(out[0].check_reason).toContain("could not be checked");
  });

  it("rejects a malformed checker response", () => {
    expect(() => parseChecks({ nope: 1 })).toThrow(CardsError);
    expect(() => parseChecks({ checks: [{ card_id: "x" }] })).toThrow(CardsError);
  });
});
