# Study Deck (working title)

Turns a notes PDF into spoken, captioned flashcards, a quiz on what you studied, and a one-page cheat sheet. Mobile-first web app. No chat window.

Planning docs, the prompt sheet and wireframes are in [`docs/`](docs/). Start with `docs/route-and-prompt-sheet.md`.

## Run locally

```
npm install
npm run dev        # http://localhost:5173
npm run build      # typecheck + production build
npm test           # unit tests
```

The `/api` functions run on Vercel. Copy `.env.example` to `.env` for local keys; never commit real keys.

## Status

v0.8.0: PDF upload, in-browser text extraction, page-range picker, AI outline, flashcards with source quotes, a grounding check that flags unsupported cards, and saved decks. A flashcard player reads each card aloud with captions, speed and voice controls, and remembers your place. A quiz covers the cards you have seen, with instant feedback and a results screen. A daily streak, daily goal and five-week calendar heatmap reward coming back. A one-page A4 cheat sheet (PDF) is made in the browser from the cards your notes support: the AI writes the short bullets and key terms once, and the PDF is laid out from the deck itself, so it works offline and always matches the cards. Any card can be edited by hand, rewritten by the AI with a note (then re-checked against your notes), or deleted; edits are marked "Edited by you" and listed in an exportable edit log. Error states and an accessibility pass come in a later tagged version.

Local AI testing without keys: put `AI_MOCK=1` in `.env` (never in production). Real use needs `GEMINI_API_KEY` and `GROQ_API_KEY`.
