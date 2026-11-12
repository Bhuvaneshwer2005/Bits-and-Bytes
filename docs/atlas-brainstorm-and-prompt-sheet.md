# Atlas — an AI study assistant with no chat window

Turns a textbook chapter into notes and quizzes. The interface is a **spatial concept map**, not a conversation.

---

## 1. Brainstorm: which interface?

| Option | Idea | Verdict |
|---|---|---|
| **A. Chapter Map (canvas)** | Chapter = a zoomable map of concepts. Zoom out = overview, zoom in = notes, drag a node to the quiz tray. | **Chosen** — shows structure, which chat hides |
| B. Swipe deck | Cards you swipe (know / don't know) | Folded in as the quiz mode |
| C. Annotated reader | The textbook page is the UI; highlight = note, long-press = quiz | Folded in as "source view" |
| D. Audio-first | Spoken recap and oral quiz | Later add-on |
| E. Game board | Concepts are territory you conquer | Too gimmicky for v1; heatmap borrows the idea |

**Principle:** the AI never "talks". It is called by gestures and buttons, returns structured JSON, and the UI renders it. The only free-text box is the *explain it in your own words* answer, and the AI grades it against a rubric rather than replying.

## 2. Features

**Core (v1)**
1. **Ingest** — paste text, upload PDF, or photo of pages. Cleaned and split into sections.
2. **Concept map** — nodes are concepts, edges are *depends-on / contrasts / example-of / causes*.
3. **Semantic zoom** — zoom out: chapter themes. Mid: concepts. In: a note card.
4. **Notes at 3 depths** — gist (1 line), standard (short paragraph), deep (with worked example). Every sentence links back to a source paragraph.
5. **Quiz from the map** — select nodes (lasso or tap), choose a mode. Types: cloze, multiple choice, order-the-steps, label-the-diagram, explain-in-your-own-words.
6. **Mastery heatmap** — nodes colored by confidence. A wrong answer tints the *prerequisite* edge, showing why you missed it.
7. **Spaced review** — nodes "fog over" as time passes; the next session starts from the foggiest.
8. **Export** — Markdown notes, Anki deck, printable one-page map.

**Guardrails:** grounded in the chapter only; anything the model adds is flagged "not in chapter"; every question stores its source span so you can check it.

**Later:** voice quiz, multi-chapter maps, shared maps for study groups, teacher view.

## 3. Route (user journey = build order = prompt chain)

```
Upload → P1 Clean → P2 Outline → P3 Concepts → P4 Relations (map appears)
      → P5 Notes (tap node) → P6 Quiz (lasso nodes) → P7 Grade (explain-back)
      → P8 Mastery update (heatmap + review queue) ──► loops back to P6
```

| Step | User sees | Build milestone (tag) |
|---|---|---|
| P1–P2 | Chapter outline appears | v0.1.0 ingest + outline |
| P3–P4 | Map draws itself | v0.2.0 concept map |
| P5 | Tap a node, get notes | v0.3.0 notes |
| P6–P7 | Lasso nodes, take quiz | v0.4.0 quiz + grading |
| P8 | Heatmap, fog, review | v0.5.0 mastery + review |
| — | Export, polish | v1.0.0 |

## 4. Prompt sheet

Every prompt starts with the same **ROUTE CONTEXT** block, so each call knows what came before, what it is doing, and what the next step needs. The app fills the `{{ }}` slots.

### Shared header (prepended to P1–P8)

```
[ROUTE CONTEXT]
Step {{n}} of 8: {{current_name}}
Previous step ({{prev_name}}): {{prev_summary}}
This step: {{current_goal}}
Next step ({{next_name}}): will consume {{next_needs}}
Your output feeds the next step directly. Follow the output schema exactly;
extra prose breaks the pipeline. Use ONLY the chapter text. If something is not
in the chapter, set "in_chapter": false.
```

### P1 — Clean
- **Previous:** none (raw upload / OCR text)
- **Next:** P2 Outline needs clean paragraphs with stable IDs
```
Clean the raw text: remove headers, footers, page numbers, OCR noise. Merge
broken lines. Keep figures/tables as "[FIGURE: caption]" placeholders.
Split into paragraphs and assign IDs p1, p2, ...
Output JSON: {"paragraphs":[{"id":"p1","text":"...","page":12}]}
```

### P2 — Outline
- **Previous:** P1 produced paragraphs with IDs
- **Next:** P3 Concepts needs sections so concepts can be grouped
```
Group the paragraphs into 3-8 sections. Each section: title, one-line summary,
and the paragraph IDs it covers. Every paragraph belongs to exactly one section.
Output JSON: {"sections":[{"id":"s1","title":"","summary":"","paragraph_ids":[]}]}
```

### P3 — Concepts
- **Previous:** P2 produced sections
- **Next:** P4 Relations needs a flat list of concepts with definitions to link
```
For each section, extract the key concepts (terms, laws, processes, people).
Per concept: name, a one-sentence definition in the chapter's own terms,
section_id, source paragraph IDs, importance 1-5.
Skip trivia. Max 8 concepts per section; no duplicates across sections.
Output JSON: {"concepts":[{"id":"c1","name":"","definition":"","section_id":"","source":[],"importance":3}]}
```

### P4 — Relations
- **Previous:** P3 produced concepts
- **Next:** P5 Notes uses edges to write connections; P8 uses `depends_on` edges to trace missed prerequisites
```
Link the concepts. Allowed edge types: depends_on, contrasts_with, example_of,
causes, part_of. Direction matters (A depends_on B means B is needed to
understand A). Only create an edge the chapter supports; include the source
paragraph ID as evidence. Aim for a connected map, not a hairball (<= 3 edges
per concept on average).
Output JSON: {"edges":[{"from":"c2","to":"c1","type":"depends_on","evidence":"p14"}]}
```

### P5 — Notes
- **Previous:** P4 produced the graph (concepts + edges)
- **Next:** P6 Quiz draws facts from these notes, so facts must be atomic and sourced
```
Write notes for concept {{concept_id}}, using its definition, its source
paragraphs, and its neighbours in the graph. Produce three depths:
gist (<=15 words), standard (<=80 words), deep (<=200 words, include one worked
example if the chapter has one). Then list "facts": atomic, testable statements,
each with a source paragraph ID. Mention connected concepts by name.
Output JSON: {"concept_id":"","gist":"","standard":"","deep":"","facts":[{"text":"","source":"p7"}]}
```

### P6 — Quiz
- **Previous:** P5 produced notes with atomic facts
- **Next:** P7 Grade needs each question's answer key, rubric and source; P8 needs `concept_id` on every question
```
Create {{count}} questions over concepts {{selected_ids}} at difficulty {{level}}.
Mix types from: cloze, mcq, order_steps, label_diagram, explain.
Base every question on a fact from P5 and cite its source. MCQ distractors must
be plausible misconceptions, not nonsense. For "explain" questions, write a
rubric of 3-4 key points the answer must contain.
Output JSON: {"questions":[{"id":"q1","type":"","concept_id":"","prompt":"","options":[],"answer":"","rubric":[],"source":"p7"}]}
```

### P7 — Grade
- **Previous:** P6 produced the questions, answer keys and rubrics
- **Next:** P8 Mastery needs per-question correctness and, for misses, the likely missing prerequisite
```
Grade the learner's answer to {{question}} against its answer key / rubric.
For explain answers, mark each rubric point as hit / partial / missed and be
lenient about wording, strict about meaning. Do NOT write a conversational
reply. If wrong, name the single most likely missing concept from this
question's depends_on neighbours.
Output JSON: {"question_id":"","score":0.0,"rubric_hits":[],"misconception":"","missing_prereq_id":"c1","source":"p7"}
```

### P8 — Mastery update
- **Previous:** P7 produced scores and missing prerequisites
- **Next:** none in the chain. Its output drives the heatmap and the next session, which restarts at P6 with the foggiest concepts
```
Given each concept's history [{date, score}], update mastery (0-1) with spaced-
repetition logic: a high score pushes the next review further out; a low score
pulls it in. Propagate half of a miss to its missing_prereq_id. Return a ranked
review queue and the heatmap colour bucket per concept.
Output JSON: {"concepts":[{"id":"","mastery":0.0,"next_review":"YYYY-MM-DD","bucket":"red|amber|green"}],"queue":["c3","c1"]}
```

## 5. Open decisions
1. Platform: web app (fastest) vs mobile-first?
2. Map library: React Flow vs D3 vs Cytoscape?
3. Model per step: a cheaper model for P1–P2, a stronger one for P4, P6 and P7?
4. Where does the learner's data live: local-only, or an account?
