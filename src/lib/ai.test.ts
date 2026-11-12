import { afterEach, describe, expect, it, vi } from "vitest";
import { AiFailure, callAI } from "./ai";

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });
const ok = (value: unknown) => json(200, { text: JSON.stringify(value), provider: "p", model: "m" });
const identity = (x: unknown) => x;

afterEach(() => vi.unstubAllGlobals());

describe("callAI", () => {
  it("waits as told and retries when rate limited", async () => {
    const waits: number[] = [];
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json(429, { error: "rate_limited", retry_after: 7 }))
      .mockResolvedValueOnce(json(429, { error: "rate_limited", retry_after: 3 }))
      .mockResolvedValueOnce(ok({ a: 1 }));
    vi.stubGlobal("fetch", fetchMock);

    const res = await callAI("P2", {}, identity, async (ms) => void waits.push(ms));
    expect(res.value).toEqual({ a: 1 });
    expect(waits).toEqual([7000, 3000]);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("caps a long wait and gives up after a few rate limits", async () => {
    const waits: number[] = [];
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => json(429, { error: "rate_limited", retry_after: 600 })));
    await expect(callAI("P2", {}, identity, async (ms) => void waits.push(ms))).rejects.toMatchObject({ kind: "rate_limited" });
    expect(waits).toHaveLength(3);
    expect(Math.max(...waits)).toBe(25_000);
  });

  it("retries once when the answer is invalid, then succeeds", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json(200, { text: "not json", provider: "p", model: "m" }))
      .mockResolvedValueOnce(ok({ fine: true }));
    vi.stubGlobal("fetch", fetchMock);
    const res = await callAI("P1", {}, identity, async () => {});
    expect(res.value).toEqual({ fine: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("fails as invalid after two unusable answers", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => ok({ bad: true })));
    const strict = () => {
      throw new Error("nope");
    };
    await expect(callAI("P1", {}, strict, async () => {})).rejects.toBeInstanceOf(AiFailure);
  });

  it("retries an unavailable AI once, then gives up", async () => {
    const fetchMock = vi.fn().mockImplementation(async () => json(502, { error: "ai_unavailable" }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(callAI("P1", {}, identity, async () => {})).rejects.toMatchObject({ kind: "unavailable" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("recovers when the second try gets through", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json(502, { error: "ai_unavailable" }))
      .mockResolvedValueOnce(ok({ fine: true }));
    vi.stubGlobal("fetch", fetchMock);
    const res = await callAI("P1", {}, identity, async () => {});
    expect(res.value).toEqual({ fine: true });
  });

  it("does not retry when the AI is not configured", async () => {
    const fetchMock = vi.fn().mockImplementation(async () => json(503, { error: "not_configured" }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(callAI("P1", {}, identity, async () => {})).rejects.toMatchObject({ kind: "not_configured" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
