// Model providers. Gemini first, Groq as the backup. Keys come from env vars only and are never logged.

export type ProviderName = "gemini" | "groq" | "mock";

export interface ProviderResult {
  text: string;
  provider: ProviderName;
  model: string;
  /** Providers tried before this one that failed, with their HTTP status (no keys, no text). */
  fallbackFrom?: { provider: ProviderName; status: number }[];
}

export class ProviderError extends Error {
  constructor(
    public provider: ProviderName,
    public status: number,
    public rateLimited: boolean,
  ) {
    super(`${provider} failed with status ${status}`);
  }
}

const TIMEOUT_MS = 25_000;

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
  if (!res.ok) throw new ProviderError("gemini", res.status, res.status === 429);
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
  if (!res.ok) throw new ProviderError("groq", res.status, res.status === 429);
  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  const text = data.choices?.[0]?.message?.content ?? "";
  if (!text) throw new ProviderError("groq", 502, false);
  return { text, provider: "groq", model };
}

/** Local testing only (AI_MOCK=1). Never set in production. Splits the pages into three even sections. */
function callMock(user: string): ProviderResult {
  const pages = [...user.matchAll(/\[page (\d+)\]/g)].map((m) => Number(m[1]));
  const first = pages[0];
  const last = pages[pages.length - 1];
  const count = Math.min(3, pages.length);
  const size = Math.ceil(pages.length / count);
  const sections = Array.from({ length: count }, (_, i) => {
    const from = first + i * size;
    const to = i === count - 1 ? last : Math.min(last, from + size - 1);
    return { id: `s${i + 1}`, title: `Mock section ${i + 1}`, summary: "Mock summary for local testing.", page_range: [from, to] };
  });
  return { text: JSON.stringify({ sections }), provider: "mock", model: "mock" };
}

export function configuredProviders(): ProviderName[] {
  if (process.env.AI_MOCK === "1") return ["mock"];
  const list: ProviderName[] = [];
  if (process.env.GEMINI_API_KEY) list.push("gemini");
  if (process.env.GROQ_API_KEY) list.push("groq");
  return list;
}

/** Tries each configured provider in order; throws the last error if all fail. */
export async function generate(system: string, user: string): Promise<ProviderResult> {
  let last: ProviderError | null = null;
  const failed: NonNullable<ProviderResult["fallbackFrom"]> = [];
  for (const name of configuredProviders()) {
    try {
      const result = name === "mock" ? callMock(user) : name === "gemini" ? await callGemini(system, user) : await callGroq(system, user);
      return failed.length ? { ...result, fallbackFrom: failed } : result;
    } catch (e) {
      last = e instanceof ProviderError ? e : new ProviderError(name, 502, false);
      failed.push({ provider: name, status: last.status });
      console.error(`provider ${name} failed (status ${last.status})`); // status only, never keys or text
    }
  }
  throw last ?? new Error("no provider configured");
}
