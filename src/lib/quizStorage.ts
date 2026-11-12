import type { QuizResult } from "./quiz";

// Quiz results. The list of finished quizzes is what the streak and heatmap read in the next step.
// Every read and write is guarded: storage can be blocked or corrupt.

const LAST_PREFIX = "sd.quiz.last.";
const LOG_KEY = "sd.quiz.log";
const MAX_LOG = 300;

export interface QuizLogEntry {
  date: string;
  at: string;
  deck: string;
  score: number;
  total: number;
}

function read<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // storage full or blocked: carry on without saving
  }
}

export function loadQuizResult(deckKey: string): QuizResult | null {
  const r = read<QuizResult>(LAST_PREFIX + deckKey);
  return r && typeof r.score === "number" && typeof r.total === "number" && Array.isArray(r.missed_card_ids) && Array.isArray(r.by_section) ? r : null;
}

export function loadQuizLog(): QuizLogEntry[] {
  const list = read<QuizLogEntry[]>(LOG_KEY);
  return Array.isArray(list) ? list.filter((e) => typeof e?.date === "string" && typeof e?.score === "number") : [];
}

/** Saves the latest result for the deck and adds the quiz to the log of finished quizzes. */
export function saveQuizResult(deckKey: string, result: QuizResult): void {
  write(LAST_PREFIX + deckKey, result);
  const log = loadQuizLog();
  log.push({ date: result.date, at: result.at, deck: deckKey, score: result.score, total: result.total });
  write(LOG_KEY, log.slice(-MAX_LOG));
}
