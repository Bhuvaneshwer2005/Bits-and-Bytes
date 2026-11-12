# Study Deck (working title)

Turns a student's notes PDF into **spoken, captioned flashcards**, a **quiz on the cards they went through**, and a **one-page cheat sheet PDF**. A daily streak and calendar heatmap reward coming back. Mobile-first, English only, **no chat window**.

Built for the "Escape the Chatbox" challenge.

- **Live:** https://bits-and-bytes-bay.vercel.app/
- **Current version:** v1.0.0 (every pushed version is an annotated git tag with a change list)
- **Submission pack:** [`docs/submission.md`](docs/submission.md)

## Try it in 30 seconds

1. Open the live link on a phone or desktop.
2. Tap **Try the sample deck** (24 cards, a quiz and a cheat sheet; no AI needed), or tap **Download a sample PDF to try the upload** and upload that file.
3. Press **Start listening**, take the quiz, then download the cheat sheet.

## What it does

| Feature | How it works |
|---|---|
| Upload | Pick a PDF (up to 20 MB, 60 pages). Text is extracted **in the browser** with pdf.js; the file is never uploaded. Scanned PDFs are refused with an explanation. |
| Outline and cards | A page range is chosen, the AI splits it into sections, then writes cards one section at a time. The first section is playable while the rest still builds. |
| Source checks | Every card has a source page and an exact quote. Code looks the quote up in the page text, then a second AI pass checks the answer against the quote. Anything that fails is flagged "check this" and is kept out of the quiz and cheat sheet. |
| Player | Cards are read aloud with the browser's voices (Web Speech API), with sentence-by-sentence captions, speed, voice and caption-size controls, Got it / Again queue, and a saved place. With no voice available, captions are timed instead. |
| Quiz | Questions cover only cards you went through. Options are shuffled with a seeded shuffle, grading is local, feedback uses icon plus text plus border (never colour alone), and missed cards can be reviewed. |
| Streak and heatmap | A day counts after 10 cards and a finished quiz. Daily goal of 5, 10 or 20 cards. Five-week heatmap is a real table with a label on every day. The demo can load clearly labelled sample history. |
| Cheat sheet | One A4 page, built in the browser with pdfmake from the deck only. It shrinks (fewer key terms, shorter bullets, smaller type) until pdf.js counts exactly one page. Works offline and always matches the current cards. |
| Edit | Edit a card by hand, regenerate it with the AI (optional note; the new version is re-checked and only saved if you press Save), or delete it. Edited cards show "Edited by you" and go in an exportable edit log. |
| Resilience | AI unavailable: plain message and a one-tap route to the sample deck. Rate limits are waited out and retried. Offline: a banner says what still works. |
| Accessibility | 44 px tap targets, visible focus rings, full keyboard use, reduced motion honoured, light and dark themes, adjustable captions. axe-core reported no violations on every screen in light and dark at 360 px and at 200% text size. |

## How it works

```
PDF -> (browser) text per page -> P1 outline -> P2 cards -> code quote check -> P3 grounding check
    -> P4 quiz -> P5 cheat-sheet summary -> (browser) one-page PDF        P6 rewrites one card on demand
```

- **deck.json is the single source of truth** (`meta`, `sections`, `cards`, `quiz`, `summary`). The AI only ever writes JSON; code does extraction, quote checks, shuffling, grading, streaks and PDF layout. Shape: [`src/types/deck.ts`](src/types/deck.ts).
- **Prompts are on the server.** The client sends `{ promptId, inputs }` to `POST /api/ai`; the server builds the prompt from an allow-listed id (P1 to P6), so the endpoint is not a free chatbot. Every prompt carries the previous, current and next step. Source: [`api/_lib/prompts.ts`](api/_lib/prompts.ts).
- **Providers:** Gemini first (default `gemini-3.5-flash-lite`), then Groq (`openai/gpt-oss-120b`, then `openai/gpt-oss-20b`; each model has its own rate limit). A provider that returns 401 or 403 is skipped for 10 minutes. Today Groq answers (Gemini's free tier is not available to our project).
- **Privacy:** the PDF stays on the device; only extracted text is sent to the free AI service, which may keep it under its own terms (the Home screen says so). Nothing is stored on a server. Decks, progress, streak and edits live in the browser's `localStorage`.
- **Limits:** 60 AI requests a minute per address (best effort, in memory). Only free tiers are used, so there is no spend to cap.

## Project layout

```
api/                 Vercel serverless functions
  ai.ts              POST /api/ai (rate limit, prompt build, provider chain)
  health.ts          GET /api/health
  _lib/              prompts.ts, providers.ts, limits.ts, api.test.ts
src/
  screens/           Home, Build, DeckOverview, Player, Quiz, Results, EditCard, OutlineView, NotFound
  components/        StreakPill, Heatmap, CheatSheetButton, EditLogPanel, OfflineBanner, OutlineList
  deck/              DeckContext (build, quiz, summary, edit orchestration)
  lib/               ai, cards, deckBuild, quiz, summary, cheatSheet, cardEdit, editLog, activity, speech, pdf, storage ...
  data/              sample-deck.json (hand-written demo deck), sample-pages.json
  styles/            tokens.css (design tokens), base.css
public/              sample-thermodynamics-notes.pdf (the sample PDF)
scripts/             make-sample-pdf.py (regenerates the sample PDF and page texts)
docs/                planning, prompt sheet, wireframes, ai-log, submission pack
```

## Run locally

```bash
npm install
npm run dev        # http://localhost:5173 (also serves /api locally)
npm run build      # typecheck + production build
npm test           # 230 unit tests
```

### Environment variables

Copy `.env.example` to `.env` for local work. In production, set them in Vercel's environment settings. **This repo is public: never commit a real key.**

| Variable | Purpose |
|---|---|
| `GROQ_API_KEY` | Groq key (currently the provider that answers) |
| `GEMINI_API_KEY` | Google Gemini key (tried first when present) |
| `GEMINI_MODEL`, `GROQ_MODELS` | Optional model overrides (`GROQ_MODELS` is a comma-separated list tried in order) |
| `AI_MOCK=1` | Local testing only: canned answers, no keys needed. Never set in production. |

With no keys, the app still works: the sample deck and everything after the AI step run without it, and the Build screen offers the sample deck when the AI is unavailable.

## Deploy

Pushing to `main` redeploys on Vercel. `vercel.json` gives `/api/ai` a 30 s limit and rewrites every non-API path to the single-page app. Static files in `public/` (such as the sample PDF) are served first.

## Versioning and rollback

Every pushed version is an annotated semver tag whose message lists the changes (`v0.0.1` to `v1.0.0`). Push with `git push origin main --follow-tags`. To go back: `git switch --detach v1.0.0` to look, `git revert <commit>` to undo safely, and never force-push `main`. Saved decks, streaks and edits are in each browser's storage, not in git.

## Docs

| File | What it is |
|---|---|
| [`docs/route-and-prompt-sheet.md`](docs/route-and-prompt-sheet.md) | Master pre-prompt, route, deck.json shape, build prompts B0 to B9, runtime prompts P1 to P6 |
| [`docs/ai-log.md`](docs/ai-log.md) | What the AI produced and what we changed by hand at every step |
| [`docs/submission.md`](docs/submission.md) | Live link, judging map, responsible AI, libraries and licences, demo script, what is not verified |
| [`docs/feature-spec.md`](docs/feature-spec.md), [`docs/problem-statement.md`](docs/problem-statement.md) | Scope and the user problem |
| [`docs/wireframes.html`](docs/wireframes.html), [`docs/prompt-sheet.pdf`](docs/prompt-sheet.pdf) | Wireframes and a printable prompt sheet |

## Built with

React 19, React Router 7, TypeScript, Vite, Vitest, zod, pdf.js (Apache-2.0), pdfmake (MIT), axe-core for development checks. Full list with licences in `docs/submission.md`.

## Known limits

English only; text PDFs only; AI output can still be wrong, which is why the source page is always one tap away. Not yet verified: Lighthouse score, a physical phone on mobile data, a real screen reader, and real model output for the quiz, summary and card-rewrite prompts (tested with a local mock).
