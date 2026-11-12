import { describe, expect, it } from "vitest";
import { allow } from "./limits";
import { buildPrompt, cleanInputs } from "./prompts";

type Pages = { pages: { page: number; text: string }[] };

describe("rate limit", () => {
  it("blocks after the per-minute cap and recovers later", () => {
    const ip = "test-ip";
    const t0 = 1_000_000;
    const results = Array.from({ length: 61 }, () => allow(ip, t0));
    expect(results.slice(0, 60).every(Boolean)).toBe(true);
    expect(results[60]).toBe(false);
    expect(allow(ip, t0 + 61_000)).toBe(true);
  });

  it("tracks addresses separately", () => {
    for (let i = 0; i < 60; i++) allow("a", 5_000_000);
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
  const card = { id: "s1c1", front: "Q", back: "A", source_page: 2, source_quote: "Entropy never decreases", context: "Entropy never decreases in an isolated system." };
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
    expect(cleanInputs("P3", { cards: [card] })).not.toBeNull();
    expect(cleanInputs("P3", { cards: [] })).toBeNull();
    expect(cleanInputs("P3", { cards: [{ ...card, source_page: "2" }] })).toBeNull();
    expect(cleanInputs("P3", { cards: [{ ...card, context: undefined }] })).toBeNull();
    expect(cleanInputs("P3", { cards: Array.from({ length: 17 }, () => card) })).toBeNull();
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

  it("P3 sends each card with its context only, and asks for one result per card", () => {
    const card = { id: "s1c1", front: "Q", back: "A", source_page: 2, source_quote: "quote", context: "some quote text around it" };
    const { system, user } = buildPrompt(cleanInputs("P3", { cards: [card] })!);
    expect(system).toContain("Step 3 of 6: Grounding check");
    expect(system).toContain("exactly one result per card id");
    expect(system).toContain("surrounding context");
    expect(user).toContain('"id":"s1c1"');
    expect(user).toContain("some quote text around it");
    expect(user).not.toContain("PAGES:");
  });

  it("P2 tells the model to leave spoken text empty unless speech needs different wording", () => {
    const { system } = buildPrompt(cleanInputs("P2", { section: { id: "s1", title: "T" }, pages: [{ page: 1, text: "x" }], count: 6 })!);
    expect(system).toContain("leave them as empty");
  });
});

describe("providers", () => {
  it("lists Groq models in order, from GROQ_MODELS", async () => {
    const { groqModels } = await import("./providers");
    const before = process.env.GROQ_MODELS;
    process.env.GROQ_MODELS = " a/one , b/two ,";
    expect(groqModels()).toEqual(["a/one", "b/two"]);
    delete process.env.GROQ_MODELS;
    expect(groqModels()[0]).toBe("openai/gpt-oss-120b");
    if (before !== undefined) process.env.GROQ_MODELS = before;
  });

  it("hands over to the next Groq model when one is rate limited, and reports the limit headers", async () => {
    const { generate } = await import("./providers");
    const saved = { g: process.env.GROQ_API_KEY, m: process.env.GROQ_MODELS, k: process.env.GEMINI_API_KEY, mock: process.env.AI_MOCK };
    process.env.GROQ_API_KEY = "test-key";
    process.env.GROQ_MODELS = "m1,m2";
    delete process.env.GEMINI_API_KEY;
    delete process.env.AI_MOCK;

    const calls: string[] = [];
    const { vi } = await import("vitest");
    vi.stubGlobal("fetch", async (_url: string, init: { body: string }) => {
      const model = JSON.parse(init.body).model as string;
      calls.push(model);
      if (model === "m1") return new Response(JSON.stringify({ error: { message: "slow down" } }), { status: 429, headers: { "retry-after": "7" } });
      return new Response(JSON.stringify({ choices: [{ message: { content: '{"ok":true}' } }] }), {
        status: 200,
        headers: { "x-ratelimit-limit-tokens": "8000", "x-ratelimit-remaining-tokens": "5400" },
      });
    });

    try {
      const res = await generate("sys", "user", "P1");
      expect(calls).toEqual(["m1", "m2"]);
      expect(res.model).toBe("m2");
      expect(res.skippedModels).toEqual(["m1"]);
      expect(res.rate).toEqual({ tokens_limit: 8000, tokens_remaining: 5400 });
    } finally {
      vi.unstubAllGlobals();
      for (const [k, v] of [["GROQ_API_KEY", saved.g], ["GROQ_MODELS", saved.m], ["GEMINI_API_KEY", saved.k], ["AI_MOCK", saved.mock]] as const) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    }
  });

  it("keeps trying other Groq models after a 400 or 500, stops on 401, and lists what it tried", async () => {
    const { generate, ProviderError } = await import("./providers");
    const { vi } = await import("vitest");
    const saved = { g: process.env.GROQ_API_KEY, m: process.env.GROQ_MODELS, k: process.env.GEMINI_API_KEY };
    process.env.GROQ_API_KEY = "test-key";
    process.env.GROQ_MODELS = "m1,m2,m3";
    delete process.env.GEMINI_API_KEY;
    try {
      const run = async (statuses: Record<string, number>) => {
        const calls: string[] = [];
        vi.stubGlobal("fetch", async (_u: string, init: { body: string }) => {
          const model = JSON.parse(init.body).model as string;
          calls.push(model);
          const status = statuses[model] ?? 200;
          return status === 200
            ? new Response(JSON.stringify({ choices: [{ message: { content: "{}" } }] }), { status: 200 })
            : new Response(JSON.stringify({ error: { message: `fail ${status}` } }), { status });
        });
        return { calls, result: await generate("s", "u", "P1").then((r) => r, (e) => e) };
      };

      const recovered = await run({ m1: 400, m2: 500 });
      expect(recovered.calls).toEqual(["m1", "m2", "m3"]);
      expect(recovered.result.model).toBe("m3");

      const allFail = await run({ m1: 500, m2: 400, m3: 500 });
      expect(allFail.result).toBeInstanceOf(ProviderError);
      expect(allFail.result.tried.map((t: { model: string; status: number }) => `${t.model}:${t.status}`)).toEqual(["m1:500", "m2:400", "m3:500"]);

      const badKey = await run({ m1: 401 });
      expect(badKey.calls).toEqual(["m1"]);
    } finally {
      vi.unstubAllGlobals();
      for (const [k, v] of [["GROQ_API_KEY", saved.g], ["GROQ_MODELS", saved.m], ["GEMINI_API_KEY", saved.k]] as const) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    }
  });

  it("retries a Groq JSON-validation 400 without strict mode and extracts the JSON", async () => {
    const { generate, extractJson } = await import("./providers");
    const { vi } = await import("vitest");
    const saved = { g: process.env.GROQ_API_KEY, m: process.env.GROQ_MODELS, k: process.env.GEMINI_API_KEY };
    process.env.GROQ_API_KEY = "test-key";
    process.env.GROQ_MODELS = "only";
    delete process.env.GEMINI_API_KEY;
    const bodies: Record<string, unknown>[] = [];
    vi.stubGlobal("fetch", async (_u: string, init: { body: string }) => {
      const body = JSON.parse(init.body) as Record<string, unknown>;
      bodies.push(body);
      if (body.response_format) {
        return new Response(JSON.stringify({ error: { message: "Failed to validate JSON. See 'failed_generation'." } }), { status: 400 });
      }
      return new Response(JSON.stringify({ choices: [{ message: { content: 'Sure!\n```json\n{"cards":[1,2]}\n```' } }] }), { status: 200 });
    });
    try {
      const res = await generate("s", "u", "P2");
      expect(bodies).toHaveLength(2);
      expect(bodies[0].response_format).toBeDefined();
      expect(bodies[1].response_format).toBeUndefined();
      expect(JSON.parse(res.text)).toEqual({ cards: [1, 2] });
    } finally {
      vi.unstubAllGlobals();
      for (const [k, v] of [["GROQ_API_KEY", saved.g], ["GROQ_MODELS", saved.m], ["GEMINI_API_KEY", saved.k]] as const) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    }
    expect(extractJson('text {"a":1} more')).toBe('{"a":1}');
    expect(extractJson("no json here")).toBe("no json here");
  });

  it("skips a provider for ten minutes after a 403, but not after a 429 or 500", async () => {
    const { isDisabled, noteFailure } = await import("./providers");
    const t = Date.now() + 3_600_000; // well after any earlier test marked a provider disabled
    noteFailure("gemini", 429, t);
    noteFailure("groq", 500, t);
    expect(isDisabled("gemini", t + 1)).toBe(false);
    expect(isDisabled("groq", t + 1)).toBe(false);
    noteFailure("gemini", 403, t);
    expect(isDisabled("gemini", t + 9 * 60_000)).toBe(true);
    expect(isDisabled("gemini", t + 11 * 60_000)).toBe(false);
  });
});
