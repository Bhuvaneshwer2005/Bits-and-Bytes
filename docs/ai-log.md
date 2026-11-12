# AI and hand-edit log

Submitted with the prompts (see `route-and-prompt-sheet.md`). One row per time AI output was used, and what we changed by hand and why.

| Date | Step | Prompt used (id) | What the AI produced | What we changed by hand and why |
|---|---|---|---|---|
| 2026-11-12 | B0 | Master pre-prompt + B0 | Vite + React + TypeScript skeleton, design tokens, home and deck overview screens, API stubs | (to fill in after review) |
| 2026-11-12 | B1 | Master pre-prompt + B1 | Upload and PDF text extraction, /api/ai proxy (Gemini then Groq), P1 outline wiring, outline repair, cache | Chose gemini-3.5-flash-lite after the docs showed gemini-2.5-flash is deprecated. Moved prompt text to the server (allow-listed ids) so the endpoint can't be used as a free chatbot. Added a local-only mock provider (AI_MOCK=1) to test without keys. Real model output not yet tested: no keys. |
| 2026-11-12 | B1 follow-up | n/a | Live test of /api/ai with real Groq key | Gemini returned 403 (free tier not available for the project), so Groq answers. Added the provider's error message to the failure report. Relaxed the minimum sections for short page ranges after the model returned 1 section for 3 pages. |
| 2026-11-12 | B2 | Master pre-prompt + B2 | P2 cards and P3 grounding-check prompts, quote check, deck builder with pacing and retries, deck overview with flagged cards | Quote check is done in code (string match) instead of by the model, and a card can only be in_source if both the code and the checker agree. If the checker fails, cards are shown but all flagged. Real model output for P2 and P3 not yet reviewed: tested with the local mock only. |
