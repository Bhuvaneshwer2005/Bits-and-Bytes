# Submission pack

**App:** Study Deck (working title). Turns a student's notes PDF into spoken, captioned flashcards, a quiz on the cards they went through, and a one-page cheat sheet. A daily streak and calendar heatmap reward coming back. There is no chat window.

- **Live link:** https://bits-and-bytes-bay.vercel.app/ (opens on a phone, English only)
- **Code:** https://github.com/Bhuvaneshwer2005/Bits-and-Bytes (every pushed version is an annotated tag, `v0.0.1` to `v1.0.0`; each tag's message lists what changed)
- **Quickest tour:** open the link, tap "Try the sample deck" (24 cards, a quiz and a cheat sheet, no AI needed). To try the full path, tap "Download a sample PDF to try the upload", then upload it.

## How it maps to the judging criteria

| Criterion | Where to look |
|---|---|
| UX | Upload to first playing card in one flow; first section plays while the rest still builds; one next action on every screen; quiz only covers cards you went through. |
| Visual design | One accent colour, light and dark themes, tokens in `src/styles/tokens.css`; every screen designed at 360 px first. |
| Accessibility | Captions on every spoken card (size adjustable), voice and speed controls, 44 px tap targets, visible focus rings, full keyboard use, reduced-motion honoured, heatmap is a real table with a label on every day and never relies on colour alone. axe-core (WCAG 2.2 AA plus best practice) reported no violations on every screen in light and dark at 360 px and at 200% text size. |
| Responsible AI | See the next section. |
| Working prototype | Live link above; 230 automated tests; Vercel deployment from this repo. |
| Presentation | Demo script below. |

## Responsible AI

- **Labelled:** every AI-made deck says "AI-generated" and every cheat sheet carries the same note.
- **Sourced:** every card and every quiz question shows the page it came from, with the exact quote.
- **Checked twice:** the quote is looked up in the PDF's own text by code, then a second AI pass checks the answer against the quote. A card that fails either is flagged "check this" and is never used for the quiz or the cheat sheet.
- **Narrow prompts:** the model only ever receives the PDF text (marked as untrusted data) and writes JSON. Code does the extraction, quote checks, shuffling, grading, streaks and PDF layout. The server holds the prompt text and accepts only fixed prompt ids, so the endpoint is not a free chatbot.
- **Human control:** any card can be edited by hand, rewritten by the AI with a note (the new version is re-checked and only saved if the learner presses Save), or deleted. Edits are marked "Edited by you" and listed in an exportable edit log.
- **Privacy:** the PDF never leaves the device; only its extracted text is sent to a free AI service, which may keep it under its own terms (the Home screen says so). We store nothing on a server. Decks, progress and edits live in the browser's own storage.
- **Fallbacks:** if the AI is unavailable the app says so in plain words and offers the sample deck; a deck without a quiz or summary still works; the cheat sheet is written straight from the cards if the AI summary cannot be made.
- **Honest limits:** English only; text PDFs only (scanned PDFs are refused with an explanation); AI output can still be wrong, which is why the source is always one tap away.

## Prompts and hand-edit log

- `docs/route-and-prompt-sheet.md`: Part A (master pre-prompt), Part D (build prompts B0 to B9, each naming the previous, current and next step), Part E (runtime prompts P1 to P6). A PDF copy is `docs/prompt-sheet.pdf`.
- The prompt text the app actually sends is in `api/_lib/prompts.ts`, with the route context (previous step, this step, next step) added to every call.
- `docs/ai-log.md`: what the AI produced and what we changed by hand at every step, including the real-model test runs and the bugs they found.

## Libraries and licences

| Library | Version | Licence | Used for |
|---|---|---|---|
| React, React DOM | 19.3.1 | MIT | UI |
| React Router | 7.18.5 | MIT | Screens and routing |
| pdf.js (`pdfjs-dist`) | 6.5.438 | Apache-2.0 | Reading PDF text in the browser; counting cheat-sheet pages |
| pdfmake | 0.3.14 | MIT | Building the cheat-sheet PDF (bundles the Roboto font, Apache-2.0) |
| zod | 4.6.7 | MIT | Checking the AI's JSON |
| Vite, Vitest, TypeScript, `@vitejs/plugin-react`, `@vercel/node`, type packages | see `package.json` | MIT / Apache-2.0 | Build, test and serverless types (development only) |
| axe-core | 4.14.0 | MPL-2.0 | Accessibility scan (development only, not shipped) |

AI services (free tiers, called from the server only): Groq (`openai/gpt-oss-120b`, then `openai/gpt-oss-20b`) answers today; Google Gemini is wired in first but its free tier is not available to our project. Keys live only in Vercel environment variables; nothing in the repository contains a key.

## Reliability and limits

- Rate limit on `/api/ai`: 60 requests a minute per address. There is no paid plan attached, so spend is capped at zero by design: when a free tier runs out the AI call fails and the app falls back as above.
- Simulated and tested: key missing (checked live: plain message and a one-tap route to the sample deck), model rate-limited (waits and retries, then lets the learner retry a section), invalid JSON (retried once, then flagged), provider outage (second model, then fallback), offline (banner says what still works).

## 3-minute demo script

1. **0:00 The user and the pain (20 s).** A first-year student with a 30-page PDF and ten minutes on a bus. Re-reading doesn't stick; making cards by hand takes an hour.
2. **0:20 Drop the notes (20 s).** Upload the sample PDF (or tap "Try the sample deck" if the network is poor). Show the steps; the first section is ready before the rest.
3. **0:40 Listen (60 s).** Play cards: voice, captions, speed. Flip one, point at its source page. Show the one flagged "check this" card and why.
4. **1:40 Quiz and streak (40 s).** Take the quiz (only cards you heard). Results screen: weakest section, streak, heatmap (labelled sample history for the demo).
5. **2:20 Control (20 s).** Edit a card, then download the one-page cheat sheet.
6. **2:40 Responsible AI (20 s).** Labels, sources, two checks, hand-edit log, privacy note.

## Not verified

- Lighthouse was not run (no Chrome available to the build tools); axe-core was, and found nothing.
- Not tested on a physical phone, on mobile data, or with a real screen reader.
- Real Groq output was reviewed for the outline, card and check prompts. The quiz, cheat-sheet and card-rewrite prompts were tested with a local mock only.
