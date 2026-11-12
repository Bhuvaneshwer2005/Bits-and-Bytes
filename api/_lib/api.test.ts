import { describe, expect, it } from "vitest";
import { allow } from "./limits";
import { buildPrompt, cleanInputs } from "./prompts";

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

describe("cleanInputs", () => {
  it("trims long pages and normalises whitespace", () => {
    const out = cleanInputs({ pages: [{ page: 1, text: "  hello\n\n world  " + "x".repeat(2000) }] });
    expect(out?.pages[0].text.length).toBeLessThanOrEqual(600);
    expect(out?.pages[0].text.startsWith("hello world")).toBe(true);
  });
  it("rejects malformed input", () => {
    expect(cleanInputs(null)).toBeNull();
    expect(cleanInputs({ pages: [] })).toBeNull();
    expect(cleanInputs({ pages: [{ page: "1", text: "x" }] })).toBeNull();
    expect(cleanInputs({ pages: Array.from({ length: 61 }, (_, i) => ({ page: i + 1, text: "x" })) })).toBeNull();
  });
});

describe("buildPrompt P1", () => {
  it("names the page span, tells the model the PDF text is untrusted, and lists the pages", () => {
    const inputs = cleanInputs({ pages: [{ page: 4, text: "alpha" }, { page: 5, text: "beta" }] })!;
    const { system, user } = buildPrompt("P1", inputs);
    expect(system).toContain("Step 1 of 6: Outline");
    expect(system).toContain("from 4 to 5");
    expect(system).toContain("untrusted data");
    expect(user).toBe("[page 4] alpha\n[page 5] beta");
  });
});
