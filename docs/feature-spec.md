# Feature spec (hackathon scope, app name TBD)

Supersedes the interface choice in `atlas-brainstorm-and-prompt-sheet.md`. The main interface is a **flashcard player with voice and captions**. There is no chat window anywhere. The data shape and prompts live in `route-and-prompt-sheet.md`; the user and demo in `problem-statement.md`; layouts in `wireframes.html`.

## The flow

```
Drop PDF -> extract text in browser -> staged AI calls (outline, cards, grounding check, quiz, summary)
         -> deck.json -> flashcards with voice + captions -> quiz on the cards you viewed
         -> results + streak + heatmap -> cheat-sheet PDF
```

## Design rules

1. **JSON is the source of truth.** The AI only writes JSON. Everything else (player, captions, audio script, quiz screen, heatmap, PDF) is rendered by our own code from `deck.json`.
2. **Light on the AI.** Cheap work stays in code: PDF extraction, quote verification (string match), quiz grading, shuffling, caption splitting, streaks, PDF layout. The deck is built in small staged calls that run per section in parallel, and the first finished section appears while the rest build.
3. **Cached.** The deck is stored by file hash, so re-opening a PDF costs nothing.
4. **Validated.** Every AI response is checked against a schema. One retry, then fall back to the bundled sample deck with a visible notice.
5. **Honest about AI.** Everything AI-made is labelled, cited to a source page, and correctable.

## Scope

### Must have (v1)
1. **Upload:** drag and drop plus browse, PDF only, 20 MB and 60-page limits, page-range picker, named build stages, duplicate detection by hash, recent decks list, scanned-PDF detection with a clear message (no OCR in v1).
2. **Deck generation:** staged prompts P1 to P5; card types term, question/answer and cloze; 8 to 12 cards per section; each card has a source page and exact source quote.
3. **Flashcard player:** flip, keyboard shortcuts, progress and section name, "Again / Got it" (Again cards return at the end), saved position.
4. **Voice and captions:** browser speech (free); auto-play reads front, pauses, flips, reads back; play/pause/skip/repeat; speed 0.75x to 1.5x; voice picker; captions on/off and three sizes; **highlight by sentence** (word-level highlighting is unreliable on phones); captions-only mode when no voice exists.
5. **Quiz:** built per section, shown after the deck, only for cards the user viewed; multiple choice, true/false, cloze; seeded shuffled options; instant feedback with icon plus text, explanation and source page; missed cards go back for review; results with score and weakest section.
6. **Streak and daily goal:** a day counts after 10 cards plus a finished quiz; daily goal of 5, 10 or 20 cards; local calendar day; stored in the browser.
7. **Calendar heatmap:** 5 weeks, each cell shows its number and has a text label (not colour-only); demo uses a clearly labelled "sample history" switch.
8. **AI transparency:** "AI-generated" label, source page on every card and question, a "check this" flag when a card is not supported by the PDF (quote not found, or P3 says no), a privacy note that PDF text goes to an AI model, and the hand-edit log in `docs/ai-log.md`.
9. **Sample deck:** bundled deck, quiz and cheat sheet, used as the demo and as the fallback when the AI is unavailable.
10. **States:** empty, error (scanned, too large, AI unavailable, no voices, offline).
11. **Accessibility:** contrast 4.5:1, visible focus, 44 px tap targets, aria-labels, headings in order, keyboard use, reduced motion, 200% text zoom without clipping.
12. **Hosting:** live HTTPS link that works on a phone, auto-deployed from GitHub; the API key lives only in the host's environment settings.

### Should have
- **Cheat-sheet PDF:** one A4 page built from `deck.json` with pdfmake, shrinking to fit.
- **Edit or regenerate a card** (P6), marked "Edited by you".

### Cut for now
XP, streak freezes, badges, reminder notifications, four PDF templates, diagram scenes, MP4 and PPTX export, OCR, cloud voice, accounts and sync, leagues, multi-language, concept map.

## Decisions made (tentative)
- Summary = a one-page cheat-sheet PDF (real .pptx later, if ever).
- Voice = the free browser voice first.
- Platform = hosted web app, mobile-first.
- Streak rule = 10 cards plus a finished quiz, local calendar day.
- Stack default = React + Vite + TypeScript, pdf.js, pdfmake, zod, one serverless function.

## Still open
- Which AI model and provider (the `/api/ai` wrapper keeps it swappable).
- Demo chapter for the sample deck.
- App name.
