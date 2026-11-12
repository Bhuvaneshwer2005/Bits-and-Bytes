import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getActivity,
  loadSampleHistory,
  recordCardCompleted,
  recordQuizFinished,
  removeSampleHistory,
  resetActivityCache,
  setDailyGoal,
  subscribeActivity,
} from "./activityStorage";

function fakeStorage() {
  const data = new Map<string, string>();
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    data,
  };
}

const KEY = "sd.activity.v1";
const noon = (y: number, m: number, d: number) => new Date(y, m - 1, d, 12, 0, 0);

beforeEach(() => {
  resetActivityCache();
  vi.stubGlobal("window", { addEventListener: () => {}, removeEventListener: () => {} });
});

afterEach(() => {
  vi.unstubAllGlobals();
  resetActivityCache();
});

describe("saved activity", () => {
  it("records cards and quizzes on the device's local day and survives a reload", () => {
    const storage = fakeStorage();
    vi.stubGlobal("localStorage", storage);
    for (let i = 0; i < 10; i++) recordCardCompleted(noon(2026, 11, 12));
    recordQuizFinished(noon(2026, 11, 12));
    expect(getActivity().streak.count).toBe(1);

    resetActivityCache(); // as if the page were reloaded
    const again = getActivity();
    expect(again.days["2026-11-12"]).toEqual({ cards: 10, quiz: true });
    expect(again.streak).toEqual({ count: 1, best: 1, last_day: "2026-11-12" });
  });

  it("uses the local day even close to midnight", () => {
    vi.stubGlobal("localStorage", fakeStorage());
    recordCardCompleted(new Date(2026, 10, 12, 23, 59, 30));
    recordCardCompleted(new Date(2026, 10, 13, 0, 0, 30));
    expect(Object.keys(getActivity().days)).toEqual(["2026-11-12", "2026-11-13"]);
  });

  it("starts empty when the saved data is corrupt or the wrong shape", () => {
    const storage = fakeStorage();
    vi.stubGlobal("localStorage", storage);
    storage.setItem(KEY, "{not json");
    expect(getActivity().days).toEqual({});
    resetActivityCache();
    storage.setItem(KEY, JSON.stringify({ days: "nope", streak: 7, goal: "big" }));
    const a = getActivity();
    expect(a.days).toEqual({});
    expect(a.goal).toBe(10);
    expect(a.streak.count).toBe(0);
  });

  it("keeps working when storage is blocked", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    });
    expect(() => recordCardCompleted(noon(2026, 11, 12))).not.toThrow();
    expect(getActivity().days["2026-11-12"].cards).toBe(1); // still counted for this visit
    expect(() => setDailyGoal(20)).not.toThrow();
    expect(getActivity().goal).toBe(20);
  });

  it("saves the daily goal", () => {
    const storage = fakeStorage();
    vi.stubGlobal("localStorage", storage);
    setDailyGoal(5);
    resetActivityCache();
    expect(getActivity().goal).toBe(5);
  });

  it("loads and removes sample history without touching the real log", () => {
    vi.stubGlobal("localStorage", fakeStorage());
    for (let i = 0; i < 3; i++) recordCardCompleted(noon(2026, 11, 12));
    const realBefore = getActivity().days;
    loadSampleHistory(noon(2026, 11, 12));
    expect(Object.keys(getActivity().sample ?? {}).length).toBeGreaterThan(20);
    expect(getActivity().days).toEqual(realBefore);
    removeSampleHistory();
    expect(getActivity().sample).toBeNull();
    expect(getActivity().days).toEqual(realBefore);
    resetActivityCache();
    expect(getActivity().sample).toBeNull(); // removal was saved
  });

  it("tells subscribers when something changes, and stops after unsubscribing", () => {
    vi.stubGlobal("localStorage", fakeStorage());
    let calls = 0;
    const stop = subscribeActivity(() => calls++);
    recordCardCompleted(noon(2026, 11, 12));
    setDailyGoal(20);
    expect(calls).toBe(2);
    stop();
    recordCardCompleted(noon(2026, 11, 12));
    expect(calls).toBe(2);
  });

  it("gives the same object until something changes, which the live store relies on", () => {
    vi.stubGlobal("localStorage", fakeStorage());
    const first = getActivity();
    expect(getActivity()).toBe(first);
    recordCardCompleted(noon(2026, 11, 12));
    expect(getActivity()).not.toBe(first);
  });
});
