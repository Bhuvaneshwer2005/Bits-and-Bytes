# AI and hand-edit log

Submitted with the prompts (see `route-and-prompt-sheet.md`). One row per time AI output was used, and what we changed by hand and why.

| Date | Step | Prompt used (id) | What the AI produced | What we changed by hand and why |
|---|---|---|---|---|
| 2026-11-12 | B0 | Master pre-prompt + B0 | Vite + React + TypeScript skeleton, design tokens, home and deck overview screens, API stubs | (to fill in after review) |
| 2026-11-12 | B1 | Master pre-prompt + B1 | Upload and PDF text extraction, /api/ai proxy (Gemini then Groq), P1 outline wiring, outline repair, cache | Chose gemini-3.5-flash-lite after the docs showed gemini-2.5-flash is deprecated. Moved prompt text to the server (allow-listed ids) so the endpoint can't be used as a free chatbot. Added a local-only mock provider (AI_MOCK=1) to test without keys. Real model output not yet tested: no keys. |
