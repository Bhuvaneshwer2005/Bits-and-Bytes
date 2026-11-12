import { z } from "zod";
import type { Card, Deck, Question, Section } from "../types/deck";

// Validation of the model's quiz (P4), the seeded option shuffle, choosing the questions to ask, and scoring.

export class QuizError extends Error {}

const rawQuestion = z.object({
  card_id: z.string(),
  type: z.enum(["mcq", "tf", "cloze"]),
  prompt: z.string(),
  options: z.array(z.string()),
  answer_index: z.number().int(),
  explanation: z.string(),
});

const container = z.object({ quiz: z.array(z.unknown()).min(1).max(20) });

const MAX_QUESTIONS_PER_SECTION = 8;
const MAX_QUIZ_LENGTH = 20;
const BANNED_OPTION = /\b(?:all|none) of the above\b|\bboth [ab] and [ab]\b/i;

/** One question checked on its own. Returns null for anything we would not want to show a student. */
export function checkQuestion(raw: unknown, cardsById: Map<string, Card>): Omit<Question, "id"> | null {
  const parsed = rawQuestion.safeParse(raw);
  if (!parsed.success) return null;
  const q = parsed.data;
  const card = cardsById.get(q.card_id);
  if (!card) return null;

  const prompt = q.prompt.trim();
  const explanation = q.explanation.trim();
  if (prompt.length < 1 || prompt.length > 160 || explanation.length < 1 || explanation.length > 200) return null;

  const options = q.options.map((o) => o.trim());
  const base = { card_id: card.id, type: q.type, prompt, explanation, source_page: card.source_page };

  if (q.type === "tf") {
    const normal = options.map((o) => o.toLowerCase());
    if (normal.length !== 2 || normal[0] !== "true" || normal[1] !== "false") return null;
    if (q.answer_index !== 0 && q.answer_index !== 1) return null;
    return { ...base, options: ["True", "False"], answer_index: q.answer_index };
  }

  if (options.length !== 4 || options.some((o) => o.length < 1 || o.length > 80 || BANNED_OPTION.test(o))) return null;
  if (new Set(options.map((o) => o.toLowerCase())).size !== 4) return null;
  if (q.answer_index < 0 || q.answer_index > 3) return null;
  if (q.type === "cloze" && !prompt.includes("__")) return null;
  return { ...base, options, answer_index: q.answer_index };
}

/**
 * Turns P4's output for one section into questions. A bad question is dropped, never retried on its own;
 * only an answer with nothing usable in it throws.
 */
export function buildQuiz(input: unknown, cards: Card[], sectionId: string): Question[] {
  const parsed = container.safeParse(input);
  if (!parsed.success) throw new QuizError("quiz does not match the schema");
  const cardsById = new Map(cards.map((c) => [c.id, c]));

  const seen = new Set<string>();
  const good: Omit<Question, "id">[] = [];
  for (const raw of parsed.data.quiz) {
    const q = checkQuestion(raw, cardsById);
    if (!q) continue;
    const key = q.prompt.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    good.push(q);
  }
  if (good.length === 0) throw new QuizError("no usable questions");
  return good.slice(0, MAX_QUESTIONS_PER_SECTION).map((q, i) => ({ ...q, id: `${sectionId}q${i + 1}` }));
}

// ---- seeded shuffle -------------------------------------------------------------------------------------

function hashString(text: string): number {
  let h = 1779033703 ^ text.length;
  for (let i = 0; i < text.length; i++) {
    h = Math.imul(h ^ text.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  return (h ^= h >>> 16) >>> 0;
}

function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface QuizItem {
  question: Question;
  options: string[];
  /** Position of the right answer in the shuffled options. */
  answerIndex: number;
}

/** Shuffles a question's options the same way for the same seed. True/False keeps its natural order. */
export function shuffleQuestion(question: Question, seed: string): QuizItem {
  if (question.type === "tf") return { question, options: question.options, answerIndex: question.answer_index };
  const rng = mulberry32(hashString(`${seed}|${question.id}`));
  const order = question.options.map((_, i) => i);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  return { question, options: order.map((i) => question.options[i]), answerIndex: order.indexOf(question.answer_index) };
}

/** The questions to ask: only for cards the learner has seen, shuffled for this attempt, at most 20. */
export function selectQuestions(deck: Deck, viewedCardIds: string[], seed: string): QuizItem[] {
  const viewed = new Set(viewedCardIds);
  let questions = deck.quiz.filter((q) => viewed.has(q.card_id));
  if (questions.length > MAX_QUIZ_LENGTH) {
    // keep a seeded sample, in deck order
    const rng = mulberry32(hashString(`${seed}|sample`));
    const keep = new Set(
      questions
        .map((_, i) => ({ i, r: rng() }))
        .sort((a, b) => a.r - b.r)
        .slice(0, MAX_QUIZ_LENGTH)
        .map((x) => x.i),
    );
    questions = questions.filter((_, i) => keep.has(i));
  }
  return questions.map((q) => shuffleQuestion(q, seed));
}

// ---- scoring --------------------------------------------------------------------------------------------

export interface SectionScore {
  section_id: string;
  title: string;
  correct: number;
  total: number;
}

export interface QuizResult {
  /** Local calendar day, YYYY-MM-DD. */
  date: string;
  at: string;
  score: number;
  total: number;
  /** Cards whose question was answered wrongly. They go back for review. */
  missed_card_ids: string[];
  by_section: SectionScore[];
  /** Section with the lowest share correct, or null if everything was right. */
  weakest_section_id: string | null;
}

export function scoreQuiz(
  items: QuizItem[],
  answers: Record<string, number>,
  cards: Card[],
  sections: Section[],
  date: string,
  now = new Date(),
): QuizResult {
  const sectionOfCard = new Map(cards.map((c) => [c.id, c.section_id]));
  const bySection = new Map<string, SectionScore>();
  const missed: string[] = [];
  let score = 0;

  for (const item of items) {
    const right = answers[item.question.id] === item.answerIndex;
    if (right) score++;
    else if (!missed.includes(item.question.card_id)) missed.push(item.question.card_id);

    const sid = sectionOfCard.get(item.question.card_id) ?? "";
    const entry = bySection.get(sid) ?? { section_id: sid, title: sections.find((s) => s.id === sid)?.title ?? "Other", correct: 0, total: 0 };
    entry.total++;
    if (right) entry.correct++;
    bySection.set(sid, entry);
  }

  const scores = sections.map((s) => bySection.get(s.id)).filter((s): s is SectionScore => !!s);
  const worst = scores.reduce<SectionScore | null>((w, s) => (!w || s.correct / s.total < w.correct / w.total ? s : w), null);

  return {
    date,
    at: now.toISOString(),
    score,
    total: items.length,
    missed_card_ids: missed,
    by_section: scores,
    weakest_section_id: worst && worst.correct < worst.total ? worst.section_id : null,
  };
}
