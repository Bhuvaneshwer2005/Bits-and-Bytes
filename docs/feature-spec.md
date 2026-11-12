# Feature spec (pre-naming draft)

Supersedes the interface choice in `atlas-brainstorm-and-prompt-sheet.md`. The concept map is dropped from v1; the main interface is a **flashcard player with voice and captions**. Still no chat window.

## The flow

```
Drop PDF -> extract text -> ONE AI call -> deck.json -> play flashcards (TTS + captions)
         -> auto quiz on the cards you saw -> summary deck -> PDF exports -> streak updates
```

## Design rule: JSON is the single source of truth

The AI only writes a compact `deck.json`. Everything else (flashcards UI, captions, audio script, quiz, summary slides, PDFs) is rendered by our own code from that file.
- Less AI work: one structured call instead of many, and short fields.
- Cheap re-runs: the JSON is cached by file hash, so re-opening a PDF costs nothing.
- Predictable output: validated against a schema; invalid output is auto-repaired with one retry.

```
deck.json
  meta      { title, source_file, pages, created }
  sections  [{ id, title, page_range }]
  cards     [{ id, section_id, type: term|qa|cloze, front, back,
               narration, captions:[{text}], source_page }]
  quiz      [{ id, card_ids, type: mcq|tf|cloze, prompt, options, answer, explanation }]
  summary   { slides:[{ title, bullets }] }
```

## Features and micro-features

### 1. Upload
- Drag-and-drop zone plus click-to-browse
- PDF validation (type, size limit, page limit) with friendly errors
- Page-range picker (to choose one chapter from a big book)
- Text extraction with OCR fallback for scanned PDFs
- Progress bar with stages (reading, understanding, building cards)
- Duplicate detection by file hash, reusing the cached deck
- Recent uploads list

### 2. AI deck generation
- One structured call producing `deck.json`
- Schema validation plus one automatic repair retry
- Card types: term/definition, question/answer, cloze
- Cards capped per section so decks stay short (default 8-15 cards per section)
- Every card keeps its `source_page`, so you can check it against the PDF
- Regenerate a single section or card without redoing the deck
- Edit or delete a card before studying

### 3. Flashcard player
- Flip animation, keyboard shortcuts (space = flip, arrows = next/back)
- Progress bar and section markers
- Mark card "got it / again"; "again" cards come back at the end
- Fullscreen and a dark mode

### 4. TTS narration with captions
- Uses an existing TTS engine; we do not train a model
- Auto-play mode: reads the front, pauses, reads the back, advances
- Play, pause, skip, repeat card, speed 0.75x-2x, voice picker
- Live captions with the current word highlighted
- Caption on/off, size, and position
- Resume where you stopped
- v1: browser built-in speech (free, gives word timing for highlighting). v2: higher-quality cloud voice, generated once and cached

### 5. Quiz after the deck
- Unlocks when you finish the cards, and covers only the cards you actually viewed
- Types: multiple choice, true/false, cloze
- Instant feedback with a one-line explanation and source page
- Missed questions send their cards back to a "review" pile
- End screen: score, time, weakest section
- Questions come from the same `deck.json`, so there is no extra AI call

### 6. Summary deck
- Auto-generated slide summary: one title slide, one slide per section, key bullets
- Viewed in-app, exported as PDF (PPTX optional later)

### 7. JSON to PDF export
- Client-side rendering, nothing uploaded for this step
- Four templates: printable flashcards (cut-out sheets), study notes, summary slides, quiz plus answer key
- Candidate library: pdfmake, because its documents are described in JSON already

### 8. Streaks (Duolingo-style)
- Daily streak: a day counts after a minimum session (e.g. 10 cards plus finishing a quiz) so it cannot be gamed by opening the app
- Daily goal setting (5 / 10 / 20 cards)
- XP for cards, quiz scores and completed decks
- Streak freeze (earned with XP) to protect a missed day
- Calendar heatmap, longest streak, milestone badges (3, 7, 30 days)
- Timezone-safe day boundary
- Optional reminder notification
- v1: stored locally in the browser; accounts come later

## Working scope (hackathon rubric, tentative)

Judged on UX 25, visual design 20, accessibility 15, responsible AI 15, working prototype 15, presentation 10. Live link must open on a phone.

**Must have:** upload, deck JSON, flashcards with voice and captions, quiz, streak badge, calendar heatmap, AI-transparency pieces (prompts submitted, source-page citations, "AI-generated" label, privacy note, log of hand edits), bundled sample deck (demo fallback).
**Should have:** a single PDF export (summary or cheat sheet), editing a card.
**Cut for now:** streak freeze, XP, four PDF templates, diagram scenes, MP4 export, PPTX.

## Not in v1
Concept map, voice quizzes, accounts and sync, leagues or friends, PPTX export, multi-language.

## Decisions needed
1. **Summary PPT**: do you want (a) a generated summary deck exported as PDF, (b) a real .pptx file, or (c) summarizing a PPT the user uploads? Draft assumes (a), with (b) later.
2. **TTS**: start with the free browser voice, or go straight to a higher-quality cloud voice?
3. **Platform**: web app first?
4. **Streak rules**: is "10 cards plus a quiz" the right bar for a day to count?
