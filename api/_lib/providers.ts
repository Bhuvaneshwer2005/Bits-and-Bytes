// Model providers. Gemini first, Groq as the backup. Keys come from env vars only and are never logged.

import type { PromptId } from "./prompts.js";

export type ProviderName = "gemini" | "groq" | "mock";

/** What a provider told us about its own rate limit (from response headers). Numbers only. */
export interface RateInfo {
  tokens_limit?: number;
  tokens_remaining?: number;
}

export interface ProviderResult {
  text: string;
  provider: ProviderName;
  model: string;
  /** Providers tried before this one that failed, with their HTTP status (no keys, no user text). */
  fallbackFrom?: { provider: ProviderName; status: number; reason?: string }[];
  /** Models of the same provider that were rate limited before this one answered. */
  skippedModels?: string[];
  rate?: RateInfo;
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
    public rate?: RateInfo,
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

function numberHeader(res: Response, name: string): number | undefined {
  const n = Number(res.headers.get(name));
  return res.headers.get(name) !== null && Number.isFinite(n) ? n : undefined;
}

function rateInfo(res: Response): RateInfo | undefined {
  const info: RateInfo = {
    tokens_limit: numberHeader(res, "x-ratelimit-limit-tokens"),
    tokens_remaining: numberHeader(res, "x-ratelimit-remaining-tokens"),
  };
  return info.tokens_limit === undefined && info.tokens_remaining === undefined ? undefined : info;
}

async function fail(provider: ProviderName, res: Response): Promise<never> {
  const retry = numberHeader(res, "retry-after");
  throw new ProviderError(
    provider,
    res.status,
    res.status === 429,
    await errorReason(res),
    retry !== undefined && retry > 0 ? Math.ceil(retry) : undefined,
    rateInfo(res),
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

/** Groq models to try in order. Each model has its own per-minute limit, so a busy one hands over to the next. */
export function groqModels(): string[] {
  const list = (process.env.GROQ_MODELS || process.env.GROQ_MODEL || "openai/gpt-oss-120b,openai/gpt-oss-20b")
    .split(",")
    .map((m) => m.trim())
    .filter(Boolean);
  return list.length ? list : ["openai/gpt-oss-120b"];
}

async function callGroqModel(system: string, user: string, model: string): Promise<ProviderResult> {
  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${process.env.GROQ_API_KEY}` },
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
  return { text, provider: "groq", model, rate: rateInfo(res) };
}

/** Tries each Groq model in turn when one is rate limited (429) or missing (404). Other errors stop the chain. */
async function callGroq(system: string, user: string): Promise<ProviderResult> {
  const skipped: string[] = [];
  let last: ProviderError | null = null;
  for (const model of groqModels()) {
    try {
      const result = await callGroqModel(system, user, model);
      return skipped.length ? { ...result, skippedModels: skipped } : result;
    } catch (e) {
      if (!(e instanceof ProviderError) || !(e.status === 429 || e.status === 404)) throw e;
      last = e;
      skipped.push(model);
    }
  }
  throw last!;
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
        say_front: "",
        say_back: "",
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

/**
 * A provider that answers 401/403 will keep doing so (bad key, no free tier), so skip it for a while
 * instead of paying a failed round trip on every call. Per server instance; resets on a cold start.
 */
const DISABLE_MS = 10 * 60_000;
const disabledUntil = new Map<ProviderName, number>();

export function isDisabled(name: ProviderName, now = Date.now()): boolean {
  return (disabledUntil.get(name) ?? 0) > now;
}

export function noteFailure(name: ProviderName, status: number, now = Date.now()): void {
  if (status === 401 || status === 403) disabledUntil.set(name, now + DISABLE_MS);
}

/** Tries each configured provider in order; throws the last error if all fail. */
export async function generate(system: string, user: string, promptId: PromptId): Promise<ProviderResult> {
  let last: ProviderError | null = null;
  const failed: NonNullable<ProviderResult["fallbackFrom"]> = [];
  const names = configuredProviders();
  // never skip the only provider we have, even if it failed before
  const usable = names.filter((n) => !isDisabled(n));
  for (const name of usable.length ? usable : names) {
    try {
      const result =
        name === "mock" ? callMock(user, promptId) : name === "gemini" ? await callGemini(system, user) : await callGroq(system, user);
      return failed.length ? { ...result, fallbackFrom: failed } : result;
    } catch (e) {
      last = e instanceof ProviderError ? e : new ProviderError(name, 502, false);
      noteFailure(name, last.status);
      failed.push({ provider: name, status: last.status, reason: last.reason });
      console.error(`provider ${name} failed (status ${last.status})`); // status only, never keys or text
    }
  }
  throw last ?? new Error("no provider configured");
}
