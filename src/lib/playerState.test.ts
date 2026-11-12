import { describe, expect, it } from "vitest";
import * as P from "./playerState";
import { DEFAULT_SETTINGS, loadPlayerState, loadSettings, savePlayerState, saveSettings } from "./playerStorage";
import type { Card } from "../types/deck";

const card = (id: string) => ({ id }) as Card;
const cards = (...ids: string[]) => ids.map(card);

describe("queue", () => {
  it("starts at the first card with nothing viewed", () => {
    const s = P.initialState(cards("a", "b", "c"));
    expect(P.currentId(s)).toBe("a");
    expect(s.viewed).toEqual([]);
    expect(P.isFinished(s)).toBe(false);
  });

  it("moves forward and back, and stops at the ends", () => {
    let s = P.initialState(cards("a", "b"));
    s = P.previous(s);
    expect(s.index).toBe(0);
    s = P.next(P.next(P.next(s)));
    expect(s.index).toBe(2);
    expect(P.isFinished(s)).toBe(true);
    expect(P.currentId(s)).toBeNull();
  });

  it("puts an Again card back at the end and remembers it", () => {
    let s = P.initialState(cards("a", "b", "c"));
    s = P.again(s); // a again
    expect(s.queue).toEqual(["a", "b", "c", "a"]);
    expect(P.currentId(s)).toBe("b");
    expect(s.again).toEqual(["a"]);
    s = P.next(P.next(s)); // b, c done
    expect(P.currentId(s)).toBe("a");
    expect(P.repeatCount(s)).toBe(1);
  });

  it("does not list a card twice in the Again list", () => {
    let s = P.initialState(cards("a", "b"));
    s = P.again(s); // a again, now on b
    s = P.again(s); // b again, queue is a b a b, now on the second a
    expect(P.currentId(s)).toBe("a");
    s = P.again(s); // a again for the second time
    expect(s.again).toEqual(["a", "b"]);
  });

  it("Got it just moves on", () => {
    let s = P.initialState(cards("a", "b"));
    s = P.gotIt(s);
    expect(s.queue).toEqual(["a", "b"]);
    expect(s.index).toBe(1);
  });

  it("does nothing on Again once the deck is finished", () => {
    let s = P.initialState(cards("a"));
    s = P.next(s);
    expect(P.again(s)).toEqual(s);
  });

  it("records viewed cards once each", () => {
    let s = P.initialState(cards("a", "b"));
    s = P.markViewed(P.markViewed(s, "a"), "a");
    expect(s.viewed).toEqual(["a"]);
  });

  it("restarts from the top, keeps what was viewed, and clears Again marks", () => {
    let s = P.initialState(cards("a", "b"));
    s = P.markViewed(P.again(s), "a");
    s = P.restart(P.next(P.next(s)), cards("a", "b"));
    expect(s.queue).toEqual(["a", "b"]);
    expect(s.index).toBe(0);
    expect(s.viewed).toEqual(["a"]);
    expect(s.again).toEqual([]);
  });
});

describe("syncWithCards", () => {
  it("adds cards that arrive later to the end of the queue", () => {
    const s = P.next(P.initialState(cards("a", "b")));
    const out = P.syncWithCards(s, cards("a", "b", "c", "d"));
    expect(out.queue).toEqual(["a", "b", "c", "d"]);
    expect(out.index).toBe(1);
  });

  it("removes deleted cards and keeps the learner on the same card", () => {
    let s = P.initialState(cards("a", "b", "c"));
    s = P.next(P.next(s)); // on c
    const out = P.syncWithCards(s, cards("b", "c"));
    expect(out.queue).toEqual(["b", "c"]);
    expect(P.currentId(out)).toBe("c");
  });

  it("drops deleted cards from the viewed and Again lists", () => {
    const s = { ...P.initialState(cards("a", "b")), viewed: ["a", "b"], again: ["a"] };
    const out = P.syncWithCards(s, cards("b"));
    expect(out.viewed).toEqual(["b"]);
    expect(out.again).toEqual([]);
  });

  it("keeps a repeated Again card in place", () => {
    let s = P.initialState(cards("a", "b"));
    s = P.again(s); // queue a b a, on b
    const out = P.syncWithCards(s, cards("a", "b", "c"));
    expect(out.queue).toEqual(["a", "b", "a", "c"]);
    expect(out.index).toBe(1);
  });
});

describe("saved state", () => {
  function fakeStorage() {
    const data = new Map<string, string>();
    return {
      getItem: (k: string) => data.get(k) ?? null,
      setItem: (k: string, v: string) => void data.set(k, v),
      data,
    };
  }

  it("round-trips the player state", async () => {
    const { vi } = await import("vitest");
    const storage = fakeStorage();
    vi.stubGlobal("localStorage", storage);
    const s = P.again(P.initialState(cards("a", "b")));
    savePlayerState("k", s);
    expect(loadPlayerState("k")).toEqual(s);
    vi.unstubAllGlobals();
  });

  it("ignores corrupt or wrongly shaped saved state", async () => {
    const { vi } = await import("vitest");
    const storage = fakeStorage();
    vi.stubGlobal("localStorage", storage);
    storage.setItem("bad", "{not json");
    storage.setItem("wrong", JSON.stringify({ queue: "a", index: 0 }));
    storage.setItem("neg", JSON.stringify({ queue: [], index: -1, viewed: [], again: [], known: [] }));
    expect(loadPlayerState("bad")).toBeNull();
    expect(loadPlayerState("wrong")).toBeNull();
    expect(loadPlayerState("neg")).toBeNull();
    expect(loadPlayerState("missing")).toBeNull();
    vi.unstubAllGlobals();
  });

  it("falls back to defaults for missing or out-of-range settings, and keeps valid ones", async () => {
    const { vi } = await import("vitest");
    const storage = fakeStorage();
    vi.stubGlobal("localStorage", storage);
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
    storage.setItem("sd.player.settings", JSON.stringify({ rate: 99, captionSize: "huge", captions: "yes" }));
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
    saveSettings({ rate: 1.25, voiceURI: "v1", captions: false, captionSize: "large" });
    expect(loadSettings()).toEqual({ rate: 1.25, voiceURI: "v1", captions: false, captionSize: "large" });
    vi.unstubAllGlobals();
  });

  it("does not throw when storage is blocked", async () => {
    const { vi } = await import("vitest");
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    });
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
    expect(loadPlayerState("k")).toBeNull();
    expect(() => savePlayerState("k", P.initialState([]))).not.toThrow();
    vi.unstubAllGlobals();
  });
});
