import { describe, expect, it } from "vitest";
import { allow } from "./limits";
import { buildPrompt, cleanInputs } from "./prompts";

type Pages = { pages: { page: number; text: string }[] };

describe("rate limit", () => {
  it("blocks after the per-minute cap and recovers later", () => {
    const ip = "test-ip";
    const t0 = 1_000_000;
    const results = Array.from({ length: 16 }, () => allow(ip, t0));
    expect(results.slice(0, 15).every(Boolean)).toBe(true);
    expect(results[15]).toBe(false);
    expect(allow(ip, t0 + 61_000)).toBe(true);
  });

  it("tracks addresses separately", () => {
    for (let i = 0; i < 15; i++) allow("a", 5_000_000);
    expect(allow("b", 5_000_000)).toBe(true);
  });
});

describe("cleanInputs P1", () => {
  it("trims long pages and normalises whitespace", () => {
    const out = cleanInputs("P1", { pages: [{ page: 1, text: "  hello\n\n world  " + "x".repeat(2000) }] });
    expect(out?.id).toBe("P1");
    const pages = (out!.inputs as Pages).pages;
    expect(pages[0].text.length).toBeLessThanOrEqual(600);
    expect(pages[0].text.startsWith("hello world")).toBe(true);
  });
  it("rejects malformed input", () => {
    expect(cleanInputs("P1", null)).toBeNull();
    expect(cleanInputs("P1", { pages: [] })).toBeNull();
    expect(cleanInputs("P1", { pages: [{ page: "1", text: "x" }] })).toBeNull();
    expect(cleanInputs("P1", { pages: Array.from({ length: 61 }, (_, i) => ({ page: i + 1, text: "x" })) })).toBeNull();
  });
});

describe("cleanInputs P2 and P3", () => {
  const pages = [{ page: 2, text: "Entropy never decreases in an isolated system." }];
  const section = { id: "s1", title: "Laws" };

  it("keeps full page text for P2, up to 4000 characters a page", () => {
    const out = cleanInputs("P2", { section, pages: [{ page: 2, text: "y".repeat(5000) }], count: 8 });
    expect((out!.inputs as Pages).pages[0].text).toHaveLength(4000);
  });
  it("rejects P2 with a bad count, a missing section, or too much text", () => {
    expect(cleanInputs("P2", { section, pages, count: 40 })).toBeNull();
    expect(cleanInputs("P2", { pages, count: 8 })).toBeNull();
    const big = Array.from({ length: 10 }, (_, i) => ({ page: i + 1, text: "z".repeat(4000) }));
    expect(cleanInputs("P2", { section, pages: big, count: 8 })).toBeNull();
  });
  it("accepts a valid P3 request and rejects malformed cards", () => {
    const card = { id: "s1c1", front: "Q", back: "A", source_page: 2, source_quote: "Entropy never decreases" };
    expect(cleanInputs("P3", { cards: [card], pages })).not.toBeNull();
    expect(cleanInputs("P3", { cards: [], pages })).toBeNull();
    expect(cleanInputs("P3", { cards: [{ ...card, source_page: "2" }], pages })).toBeNull();
    expect(cleanInputs("P3", { cards: Array.from({ length: 17 }, () => card), pages })).toBeNull();
  });
});

describe("buildPrompt", () => {
  it("P1 names the page span, tells the model the PDF text is untrusted, and lists the pages", () => {
    const { system, user } = buildPrompt(cleanInputs("P1", { pages: [{ page: 4, text: "alpha" }, { page: 5, text: "beta" }] })!);
    expect(system).toContain("Step 1 of 6: Outline");
    expect(system).toContain("from 4 to 5");
    expect(system).toContain("untrusted data");
    expect(user).toBe("[page 4] alpha\n[page 5] beta");
  });

  it("P2 names the section and pages and asks for exact quotes", () => {
    const p = cleanInputs("P2", {
      section: { id: "s2", title: "Entropy" },
      pages: [{ page: 4, text: "alpha" }, { page: 5, text: "beta" }],
      count: 8,
    })!;
    const { system, user } = buildPrompt(p);
    expect(system).toContain("Step 2 of 6: Cards");
    expect(system).toContain("section s2 (Entropy)");
    expect(system).toContain("pages 4-5");
    expect(system).toContain("character for character");
    expect(system).toContain("untrusted data");
    expect(user).toBe("[page 4] alpha\n[page 5] beta");
  });

  it("P3 includes the cards and pages and asks for one result per card", () => {
    const card = { id: "s1c1", front: "Q", back: "A", source_page: 2, source_quote: "quote" };
    const { system, user } = buildPrompt(cleanInputs("P3", { cards: [card], pages: [{ page: 2, text: "quote text" }] })!);
    expect(system).toContain("Step 3 of 6: Grounding check");
    expect(system).toContain("exactly one result per card id");
    expect(user).toContain('"id":"s1c1"');
    expect(user).toContain("[page 2] quote text");
  });
});
