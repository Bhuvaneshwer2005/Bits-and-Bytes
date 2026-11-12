# Route and prompt sheet (hackathon scope, tentative)

Replaces the prompt sheet in `atlas-brainstorm-and-prompt-sheet.md`. Scope comes from `feature-spec.md` ("Working scope").

## 1. Route

Code steps do the cheap, predictable work. The AI is called only where language understanding is needed, and it only ever writes JSON.

```
 C1 Upload + extract text (code)
  -> P1 Outline  -> P2 Cards  -> P3 Grounding check  -> P4 Quiz  -> P5 Summary
  -> C2 Assemble + validate deck.json, cache by file hash (code)
  -> C3 Player: flashcards + TTS + captions (code)
  -> C4 Quiz screen (code, graded locally)
  -> C5 Streak + heatmap log (code, localStorage)
  -> C6 PDF export (code, from deck.json)

 On demand: P6 Regenerate one card -> back through P3 -> its quiz question rebuilt by P4
```

| Step | What the user sees | Tag |
|---|---|---|
| C1 + P1 | Drop a PDF, pick pages, progress bar, outline appears | v0.1.0 |
| P2 + P3 + C2 | Cards appear grouped by section, with "AI-generated" label and source pages | v0.2.0 |
| C3 | Flashcards play with voice and captions | v0.3.0 |
| P4 + C4 | Quiz after the deck | v0.4.0 |
| C5 | Streak badge and calendar heatmap | v0.5.0 |
| P5 + C6 | One-page summary / cheat sheet PDF | v0.6.0 |
| P6 | Edit or regenerate a card; hand-edit log | v0.7.0 |
| Sample deck + polish | Bundled demo deck, error and empty states, accessibility pass | v1.0.0 |

Every AI call has a fallback: a retry once, then the bundled sample deck with a visible notice saying so.

## 2. deck.json (what the AI steps fill in)

```
meta     { title, source_file, file_hash, pages, model, created, ai_generated: true }
sections [{ id, title, page_range, summary }]
cards    [{ id, section_id, type: term|qa|cloze, front, back,
            say_front, say_back,            // spoken text; captions are split from this in code
            source_page, source_quote,      // short exact quote from the PDF
            in_source: true|false,          // set by P3
            edited_by_user: false }]
quiz     [{ id, card_id, type: mcq|tf|cloze, prompt, options, answer_index, explanation, source_page }]
summary  { bullets_by_section: [{ section_id, bullets }], key_terms: [{ term, meaning }] }
```

## 3. Prompt sheet

Every AI call starts with this block. The app fills the `{{ }}` slots, so each prompt knows what came before, what it is doing, and what the next step needs.

```
[ROUTE CONTEXT]
Step {{n}} of 6: {{current_name}}
Previous step ({{prev_name}}): {{prev_summary}}
This step: {{current_goal}}
Next step ({{next_name}}): will consume {{next_needs}}
Output JSON only, exactly matching the schema. Your output goes straight into
the next step, and any extra text breaks it. Use ONLY the supplied PDF text.
If something is not in it, set "in_source": false rather than inventing.
Write plain English a first-year student understands.
```

### P1: Outline
- **Previous:** C1 extracted the text, with page numbers and heading candidates
- **Next:** P2 needs sections with page ranges so it can build cards one section at a time
```
Group the text into 3-8 sections. For each: a short title, a one-sentence
summary, and the page range it covers. Every page belongs to one section.
Output: {"sections":[{"id":"s1","title":"","summary":"","page_range":[1,3]}]}
```

### P2: Cards
- **Previous:** P1 produced sections with page ranges
- **Next:** P3 checks each card against its source quote, so every card must carry one
```
For section {{section_id}} ({{title}}), using only the text of pages {{range}},
write {{n}} flashcards (default 8-12). Types: term (word -> meaning), qa
(question -> answer), cloze (sentence with one blank). Keep fronts under 15
words and backs under 35. Also write say_front and say_back: the same content
as natural spoken English (spell out symbols, formulas and abbreviations so a
voice can read them). Add source_page and a short exact source_quote.
Output: {"cards":[{"id":"","section_id":"","type":"","front":"","back":"","say_front":"","say_back":"","source_page":0,"source_quote":""}]}
```

### P3: Grounding check
- **Previous:** P2 produced cards with source quotes
- **Next:** P4 builds the quiz only from cards marked in_source true, and the app shows a "check this" flag on the rest
```
For each card, decide whether its back is fully supported by its source_quote
and the page text. Mark in_source true or false. If false, give a one-line
reason. Do not rewrite cards. Be strict: a claim that goes beyond the quote
is false.
Output: {"checks":[{"card_id":"","in_source":true,"reason":""}]}
```

### P4: Quiz
- **Previous:** P3 marked which cards are supported by the PDF
- **Next:** C4 shows the quiz and grades locally (so each question needs one correct answer index); P5 reuses the same verified cards
```
Using ONLY cards with in_source true, write {{count}} questions (default 10),
each tied to a card_id. Mix mcq (4 options), tf and cloze. MCQ distractors
must be plausible misconceptions from the same section, never silly. Include a
one-sentence explanation and the source_page. Do not place the answer in a
fixed position; the app shuffles options afterwards.
Output: {"quiz":[{"id":"","card_id":"","type":"","prompt":"","options":[],"answer_index":0,"explanation":"","source_page":0}]}
```

### P5: Summary / cheat sheet
- **Previous:** P4 produced the quiz from verified cards
- **Next:** C6 lays this out as a one-page PDF, so it must be short enough to fit
```
From the verified cards only, write a one-page cheat sheet: for each section,
up to 4 bullets of at most 18 words, then up to 10 key terms with a meaning of
at most 12 words. No new facts beyond the cards.
Output: {"summary":{"bullets_by_section":[{"section_id":"","bullets":[]}],"key_terms":[{"term":"","meaning":""}]}}
```

### P6: Regenerate one card (on demand, from the edit screen)
- **Previous:** P2 originally wrote this card, and the user asked for a better version
- **Next:** P3 re-checks the new card, and P4 rewrites its quiz question
```
Rewrite card {{card_id}} using only page {{source_page}}. Reason for the
rewrite, from the user: "{{user_note}}". Keep the same type unless the note
asks otherwise. Same schema as P2, one card.
Output: {"card":{...}}
```

## 4. Responsible-AI log (rubric: "your submitted prompts + what you changed by hand")

Keep this table updated as we build. It is submitted along with the prompts above.

| Date | Where | Prompt used (id or link) | What the AI produced | What we changed by hand and why |
|---|---|---|---|---|
| | | | | |

The app mirrors it for users: an "AI-generated" label on every deck, the source page on every card and question, a "check this" flag when P3 says `in_source` is false, and `edited_by_user` marking cards a person changed.

## 5. Open items
1. Which model and which voice service (browser voice assumed first).
2. Where the API key lives (one serverless function assumed).
3. Sample deck topic for the demo.
4. Whether P3 uses the same model or a cheaper one.
