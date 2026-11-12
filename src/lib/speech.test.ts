import { afterEach, describe, expect, it, vi } from "vitest";
import { estimateMs, narrate, splitSentences, type CancelToken } from "./speech";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("splitSentences", () => {
  it("splits on sentence ends", () => {
    expect(splitSentences("Entropy never decreases. Heat flows hot to cold! Is that all? Yes.")).toEqual([
      "Entropy never decreases.",
      "Heat flows hot to cold!",
      "Is that all?",
      "Yes.",
    ]);
  });
  it("does not cut after common abbreviations", () => {
    expect(splitSentences("Use a unit, e.g. kelvin, for this. See Fig. 3 for details.")).toEqual([
      "Use a unit, e.g. kelvin, for this.",
      "See Fig. 3 for details.",
    ]);
  });
  it("still splits after words like no", () => {
    expect(splitSentences("The answer is no. The next one is yes.")).toEqual(["The answer is no.", "The next one is yes."]);
  });
  it("returns one sentence for text without punctuation, and nothing for empty text", () => {
    expect(splitSentences("a measure of disorder")).toEqual(["a measure of disorder"]);
    expect(splitSentences("   ")).toEqual([]);
  });
  it("collapses whitespace and newlines", () => {
    expect(splitSentences("One   sentence\nhere.  Another.")).toEqual(["One sentence here.", "Another."]);
  });
});

describe("estimateMs", () => {
  it("never goes below 1.2 seconds, grows with length, and shrinks at faster speeds", () => {
    expect(estimateMs("Hi.", 1)).toBe(1200);
    const long = "word ".repeat(40);
    expect(estimateMs(long, 1)).toBeGreaterThan(estimateMs("word ".repeat(10), 1));
    expect(estimateMs(long, 1.5)).toBeLessThan(estimateMs(long, 1));
  });
});

describe("narrate (no voice: timed captions)", () => {
  it("reports each sentence in order, holding each on screen for its estimated time", async () => {
    vi.useFakeTimers();
    const seen: number[] = [];
    const token: CancelToken = { cancelled: false };
    const done = narrate(["One two three.", "Four five."], { rate: 1, voice: null, useVoice: false }, (i) => seen.push(i), token);
    expect(seen).toEqual([0]);
    await vi.advanceTimersByTimeAsync(1200);
    expect(seen).toEqual([0, 1]);
    await vi.advanceTimersByTimeAsync(1200);
    await done;
    expect(seen).toEqual([0, 1]);
  });

  it("stops when cancelled", async () => {
    vi.useFakeTimers();
    const seen: number[] = [];
    const token: CancelToken = { cancelled: false };
    const done = narrate(["A one.", "B two.", "C three."], { rate: 1, voice: null, useVoice: false }, (i) => seen.push(i), token);
    await vi.advanceTimersByTimeAsync(1200);
    token.cancelled = true;
    await vi.advanceTimersByTimeAsync(5000);
    await done;
    expect(seen).toEqual([0, 1]);
  });
});

describe("narrate (with a voice)", () => {
  function stubSpeech(onSpeak: (text: string) => void) {
    class Utterance {
      onend: (() => void) | null = null;
      onerror: (() => void) | null = null;
      rate = 1;
      lang = "";
      voice: unknown = null;
      constructor(public text: string) {}
    }
    vi.stubGlobal("SpeechSynthesisUtterance", Utterance);
    vi.stubGlobal("window", {
      speechSynthesis: {
        speak: (u: Utterance) => {
          onSpeak(u.text);
          queueMicrotask(() => u.onend?.());
        },
        resume: () => {},
        cancel: () => {},
        getVoices: () => [],
        addEventListener: () => {},
        removeEventListener: () => {},
      },
    });
  }

  it("speaks each sentence once, in order, and highlights as it goes", async () => {
    const spoken: string[] = [];
    stubSpeech((t) => spoken.push(t));
    const seen: number[] = [];
    await narrate(["First.", "Second."], { rate: 1.25, voice: null, useVoice: true }, (i) => seen.push(i), { cancelled: false });
    expect(spoken).toEqual(["First.", "Second."]);
    expect(seen).toEqual([0, 1]);
  });

  it("does not start another sentence once cancelled", async () => {
    const spoken: string[] = [];
    const token: CancelToken = { cancelled: false };
    stubSpeech((t) => {
      spoken.push(t);
      token.cancelled = true; // cancelled while the first sentence is being said
    });
    await narrate(["First.", "Second.", "Third."], { rate: 1, voice: null, useVoice: true }, () => {}, token);
    expect(spoken).toEqual(["First."]);
  });
});
