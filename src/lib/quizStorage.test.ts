import { afterEach, describe, expect, it, vi } from "vitest";
import type { QuizResult } from "./quiz";
import { loadQuizLog, loadQuizResult, saveQuizResult } from "./quizStorage";
import { localDate } from "./dates";

afterEach(() => vi.unstubAllGlobals());

function fakeStorage() {
  const data = new Map<string, string>();
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    data,
  };
}

const result = (over: Partial<QuizResult> = {}): QuizResult => ({
  date: "2026-11-12",
  at: "2026-11-12T10:00:00.000Z",
  score: 8,
  total: 10,
  missed_card_ids: ["c3"],
  by_section: [{ section_id: "s1", title: "Laws", correct: 8, total: 10 }],
  weakest_section_id: "s1",
  ...over,
});

describe("quiz results", () => {
  it("saves the latest result per deck and logs every finished quiz", () => {
    vi.stubGlobal("localStorage", fakeStorage());
    saveQuizResult("deckA", result());
    saveQuizResult("deckA", result({ score: 10, missed_card_ids: [], weakest_section_id: null }));
    saveQuizResult("deckB", result({ score: 5 }));
    expect(loadQuizResult("deckA")?.score).toBe(10);
    expect(loadQuizResult("deckB")?.score).toBe(5);
    expect(loadQuizLog().map((e) => `${e.deck}:${e.score}`)).toEqual(["deckA:8", "deckA:10", "deckB:5"]);
  });

  it("ignores corrupt or wrongly shaped saved data", () => {
    const storage = fakeStorage();
    vi.stubGlobal("localStorage", storage);
    storage.setItem("sd.quiz.last.x", "{broken");
    storage.setItem("sd.quiz.last.y", JSON.stringify({ score: "high" }));
    storage.setItem("sd.quiz.log", JSON.stringify([{ nonsense: true }, { date: "2026-11-12", score: 3, total: 4, at: "", deck: "d" }]));
    expect(loadQuizResult("x")).toBeNull();
    expect(loadQuizResult("y")).toBeNull();
    expect(loadQuizResult("missing")).toBeNull();
    expect(loadQuizLog()).toHaveLength(1);
  });

  it("keeps only the latest 300 log entries", () => {
    vi.stubGlobal("localStorage", fakeStorage());
    for (let i = 0; i < 305; i++) saveQuizResult("d", result({ score: i }));
    const log = loadQuizLog();
    expect(log).toHaveLength(300);
    expect(log[0].score).toBe(5);
  });

  it("does not throw when storage is blocked", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    });
    expect(() => saveQuizResult("d", result())).not.toThrow();
    expect(loadQuizResult("d")).toBeNull();
    expect(loadQuizLog()).toEqual([]);
  });
});

describe("localDate", () => {
  it("uses the device's local calendar day, padded", () => {
    expect(localDate(new Date(2026, 0, 5, 23, 59))).toBe("2026-01-05");
    expect(localDate(new Date(2026, 11, 31, 0, 1))).toBe("2026-12-31");
  });
});
