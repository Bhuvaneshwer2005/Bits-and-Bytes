import { describe, expect, it } from "vitest";
import { minSections, normalizeOutline, OutlineError } from "./outline";
import { minSections as serverMin } from "../../api/_lib/prompts";

const sec = (title: string, from: number, to: number) => ({ title, summary: "s", page_range: [from, to] });

describe("normalizeOutline", () => {
  it("accepts a clean outline and numbers the sections", () => {
    const out = normalizeOutline({ sections: [sec("A", 1, 3), sec("B", 4, 6), sec("C", 7, 9)] }, 1, 9);
    expect(out.map((s) => s.id)).toEqual(["s1", "s2", "s3"]);
    expect(out.map((s) => s.page_range)).toEqual([[1, 3], [4, 6], [7, 9]]);
  });

  it("closes gaps and overlaps so every page is covered exactly once", () => {
    const out = normalizeOutline({ sections: [sec("A", 1, 2), sec("B", 5, 6), sec("C", 6, 7)] }, 1, 9);
    expect(out[0].page_range[0]).toBe(1);
    expect(out[out.length - 1].page_range[1]).toBe(9);
    for (let i = 1; i < out.length; i++) expect(out[i].page_range[0]).toBe(out[i - 1].page_range[1] + 1);
  });

  it("sorts sections that come back out of order", () => {
    const out = normalizeOutline({ sections: [sec("C", 7, 9), sec("A", 1, 3), sec("B", 4, 6)] }, 1, 9);
    expect(out.map((s) => s.title)).toEqual(["A", "B", "C"]);
  });

  it("works when the range does not start at page 1", () => {
    const out = normalizeOutline({ sections: [sec("A", 10, 12), sec("B", 13, 15), sec("C", 16, 20)] }, 10, 20);
    expect(out[0].page_range[0]).toBe(10);
    expect(out[2].page_range[1]).toBe(20);
  });

  it("allows fewer than three sections for a very short range", () => {
    const out = normalizeOutline({ sections: [sec("A", 1, 1), sec("B", 2, 2)] }, 1, 2);
    expect(out).toHaveLength(2);
  });

  it("accepts a single section for a three-page range", () => {
    expect(normalizeOutline({ sections: [sec("A", 1, 3)] }, 1, 3)).toHaveLength(1);
  });

  it("keeps the client and server minimums in sync", () => {
    for (let n = 1; n <= 60; n++) expect(minSections(n)).toBe(serverMin(n));
  });

  it("rejects too few sections for a long range", () => {
    expect(() => normalizeOutline({ sections: [sec("A", 1, 9)] }, 1, 9)).toThrow(OutlineError);
  });

  it("rejects more than 8 sections or the wrong shape", () => {
    const many = Array.from({ length: 9 }, (_, i) => sec(`S${i}`, i + 1, i + 1));
    expect(() => normalizeOutline({ sections: many }, 1, 9)).toThrow(OutlineError);
    expect(() => normalizeOutline({ nope: true }, 1, 9)).toThrow(OutlineError);
    expect(() => normalizeOutline(null, 1, 9)).toThrow(OutlineError);
  });

  it("never produces an empty section", () => {
    const out = normalizeOutline({ sections: [sec("A", 1, 9), sec("B", 9, 9), sec("C", 9, 9)] }, 1, 9);
    for (const s of out) expect(s.page_range[0]).toBeLessThanOrEqual(s.page_range[1]);
  });
});
