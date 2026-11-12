# Study Deck (working title)

Turns a notes PDF into spoken, captioned flashcards, a quiz on what you studied, and a one-page cheat sheet. Mobile-first web app. No chat window.

Planning docs, the prompt sheet and wireframes are in [`docs/`](docs/). Start with `docs/route-and-prompt-sheet.md`.

## Run locally

```
npm install
npm run dev        # http://localhost:5173
npm run build      # typecheck + production build
```

The `/api` functions run on Vercel. Copy `.env.example` to `.env` for local keys; never commit real keys.

## Status

v0.1.0: skeleton, design tokens, home and deck overview screens, bundled sample deck. Upload, AI, player, quiz, streak and PDF export come in later tagged versions.
