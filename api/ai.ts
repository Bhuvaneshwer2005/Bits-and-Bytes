import type { VercelRequest, VercelResponse } from "@vercel/node";
import { allow } from "./_lib/limits.js";
import { buildPrompt, cleanInputs, isPromptId } from "./_lib/prompts.js";
import { configuredProviders, generate, ProviderError } from "./_lib/providers.js";

// POST /api/ai  { promptId: "P1" | "P2" | "P3", inputs: {...} }  ->  { text, provider, model }
// The client validates `text` (JSON) against its own schema.
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.setHeader("allow", "POST");
    return res.status(405).json({ error: "method_not_allowed" });
  }

  const forwarded = req.headers["x-forwarded-for"];
  const ip = (Array.isArray(forwarded) ? forwarded[0] : forwarded)?.split(",")[0].trim() || req.socket?.remoteAddress || "unknown";
  // `source` says whose limit was hit, so a slow build can be diagnosed from the browser
  if (!allow(ip)) return res.status(429).json({ error: "rate_limited", source: "app", retry_after: 10 });

  const body = req.body as { promptId?: unknown; inputs?: unknown } | undefined;
  if (!body || !isPromptId(body.promptId)) return res.status(400).json({ error: "bad_request" });
  const prompt = cleanInputs(body.promptId, body.inputs);
  if (!prompt) return res.status(400).json({ error: "bad_inputs" });

  if (configuredProviders().length === 0) return res.status(503).json({ error: "not_configured" });

  try {
    const { system, user } = buildPrompt(prompt);
    const result = await generate(system, user, prompt.id);
    return res.status(200).json(result);
  } catch (e) {
    if (e instanceof ProviderError && e.rateLimited) {
      return res.status(429).json({ error: "rate_limited", source: "provider", retry_after: e.retryAfter ?? 10, rate: e.rate });
    }
    // `tried` lists each attempt's status and the provider's short error, so failures can be diagnosed from the browser
    return res.status(502).json({ error: "ai_unavailable", tried: e instanceof ProviderError ? e.tried : [] });
  }
}
