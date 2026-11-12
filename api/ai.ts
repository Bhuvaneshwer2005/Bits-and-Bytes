import type { VercelRequest, VercelResponse } from "@vercel/node";

// Stub. B1 implements: Gemini first, Groq on error or rate limit, per-IP rate limit.
// Keys are read from GEMINI_API_KEY and GROQ_API_KEY and are never logged.
export default function handler(_req: VercelRequest, res: VercelResponse) {
  res.status(501).json({ error: "AI proxy not implemented yet" });
}
