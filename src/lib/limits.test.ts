import { describe, expect, it } from "vitest";
import { checkFileBasics, looksScanned, MAX_BYTES } from "./limits";

describe("checkFileBasics", () => {
  it("accepts a normal PDF", () => {
    expect(checkFileBasics({ name: "notes.pdf", type: "application/pdf", size: 1000 })).toBeNull();
  });
  it("accepts a PDF whose type is blank but name ends in .pdf", () => {
    expect(checkFileBasics({ name: "Notes.PDF", type: "", size: 1000 })).toBeNull();
  });
  it("rejects other file types", () => {
    expect(checkFileBasics({ name: "notes.docx", type: "application/msword", size: 1000 })).toBe("not_pdf");
  });
  it("rejects files over 20 MB", () => {
    expect(checkFileBasics({ name: "big.pdf", type: "application/pdf", size: MAX_BYTES + 1 })).toBe("too_big");
  });
});

describe("looksScanned", () => {
  it("flags pages with almost no text", () => {
    expect(looksScanned(["", "  ", "3"])).toBe(true);
    expect(looksScanned([])).toBe(true);
  });
  it("passes normal text pages", () => {
    expect(looksScanned(["Entropy is a measure of the disorder of a system.", "Heat engines turn heat into work."])).toBe(false);
  });
});
