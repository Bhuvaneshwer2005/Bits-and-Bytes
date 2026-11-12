// Model providers. Gemini first, Groq as the backup. Keys come from env vars only and are never logged.

import type { PromptId } from "./prompts.js";

export type ProviderName = "gemini" | "groq" | "mock";

export interface ProviderResult {
  text: string;
  provider: ProviderName;
  model: string;
  /** Providers tried before this one that failed, with their HTTP status (no keys, no user text). */
  fallbackFrom?: { provider: ProviderName; status: number; reason?: string }[];
}

export class ProviderError extends Error {
  constructor(
    public provider: ProviderName,
    public status: number,
    public rateLimited: boolean,
    /** The provider's own error message, shortened. Contains no keys or user text. */
    public reason?: string,
    /** Seconds the provider asked us to wait, when it said. */
    public retryAfter?: number,
  ) {
    super(`${provider} failed with status ${status}`);
  }
}

const TIMEOUT_MS = 25_000;

/** Pulls the provider's error message out of a failed response, shortened. */
async function errorReason(res: Response): Promise<string | undefined> {
  try {
    const body = (await res.json()) as { error?: { message?: string } | string };
    const msg = typeof body.error === "string" ? body.error : body.error?.message;
    return msg?.slice(0, 160);
  } catch {
    return undefined;
  }
}

async function fail(provider: ProviderName, res: Response): Promise<never> {
  const header = Number(res.headers.get("retry-after"));
  throw new ProviderError(
    provider,
    res.status,
    res.status === 429,
    await errorReason(res),
    Number.isFinite(header) && header > 0 ? Math.ceil(header) : undefined,
  );
}

async function callGemini(system: string, user: string): Promise<ProviderResult> {
  const key = process.env.GEMINI_API_KEY!;
  const model = process.env.GEMINI_MODEL || "gemini-3.5-flash-lite";
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-goog-api-key": key },
    signal: AbortSignal.timeout(TIMEOUT_MS),
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: "user", parts: [{ text: user }] }],
      generationConfig: { responseMimeType: "application/json", temperature: 0.2 },
    }),
  });
  if (!res.ok) return fail("gemini", res);
  const data = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
  const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
  if (!text) throw new ProviderError("gemini", 502, false);
  return { text, provider: "gemini", model };
}

async function callGroq(system: string, user: string): Promise<ProviderResult> {
  const key = process.env.GROQ_API_KEY!;
  const model = process.env.GROQ_MODEL || "openai/gpt-oss-120b";
  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
    signal: AbortSignal.timeout(TIMEOUT_MS),
    body: JSON.stringify({
      model,
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
  });
  if (!res.ok) return fail("groq", res);
  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  const text = data.choices?.[0]?.message?.content ?? "";
  if (!text) throw new ProviderError("groq", 502, false);
  return { text, provider: "groq", model };
}

/** Local testing only (AI_MOCK=1). Never set in production. Produces plausible JSON from the prompt's own text. */
function callMock(user: string, promptId: PromptId): ProviderResult {
  const done = (value: unknown): ProviderResult => ({ text: JSON.stringify(value), provider: "mock", model: "mock" });

  if (promptId === "P3") {
    const ids = [...user.matchAll(/"id":"([^"]+)"/g)].map((m) => m[1]);
    return done({
      checks: ids.map((id, i) => ({
        card_id: id,
        in_source: i % 7 !== 6,
        reason: i % 7 !== 6 ? "" : "Mock: the answer goes beyond the page.",
      })),
    });
  }

  const pages = [...user.matchAll(/\[page (\d+)\] ([^\n]*)/g)].map((m) => ({ page: Number(m[1]), text: m[2] }));

  if (promptId === "P1") {
    const first = pages[0].page;
    const last = pages[pages.length - 1].page;
    const count = Math.min(3, pages.length);
    const size = Math.ceil(pages.length / count);
    return done({
      sections: Array.from({ length: count }, (_, i) => {
        const from = first + i * size;
        const to = i === count - 1 ? last : Math.min(last, from + size - 1);
        return { id: `s${i + 1}`, title: `Mock section ${i + 1}`, summary: "Mock summary for local testing.", page_range: [from, to] };
      }),
    });
  }

  // P2: cards quoting the page text, so the quote check passes
  const cards = pages.flatMap((p) => {
    const words = p.text.split(" ").filter(Boolean);
    const out = [];
    for (let i = 0; i + 10 <= words.length && out.length < 4; i += 10) {
      out.push({
        type: "term",
        front: `Mock: what comes after "${words.slice(i, i + 3).join(" ")}"?`,
        back: words.slice(i + 3, i + 10).join(" "),
        say_front: `Mock question about ${words.slice(i, i + 3).join(" ")}`,
        say_back: words.slice(i + 3, i + 10).join(" "),
        source_page: p.page,
        source_quote: words.slice(i, i + 8).join(" "),
      });
    }
    return out;
  });
  return done({ cards: cards.slice(0, 12) });
}

export function configuredProviders(): ProviderName[] {
  if (process.env.AI_MOCK === "1") return ["mock"];
  const list: ProviderName[] = [];
  if (process.env.GEMINI_API_KEY) list.push("gemini");
  if (process.env.GROQ_API_KEY) list.push("groq");
  return list;
}

/** Tries each configured provider in order; throws the last error if all fail. */
export async function generate(system: string, user: string, promptId: PromptId): Promise<ProviderResult> {
  let last: ProviderError | null = null;
  const failed: NonNullable<ProviderResult["fallbackFrom"]> = [];
  for (const name of configuredProviders()) {
    try {
      const result =
        name === "mock" ? callMock(user, promptId) : name === "gemini" ? await callGemini(system, user) : await callGroq(system, user);
      return failed.length ? { ...result, fallbackFrom: failed } : result;
    } catch (e) {
      last = e instanceof ProviderError ? e : new ProviderError(name, 502, false);
      failed.push({ provider: name, status: last.status, reason: last.reason });
      console.error(`provider ${name} failed (status ${last.status})`); // status only, never keys or text
    }
  }
  throw last ?? new Error("no provider configured");
}
