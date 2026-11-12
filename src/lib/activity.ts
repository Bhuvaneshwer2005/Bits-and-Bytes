// The learner's daily activity: cards studied, quizzes finished, the streak, and the daily goal.
// Everything here is a pure function of its inputs. Days are the device's LOCAL calendar days (YYYY-MM-DD).

export const STREAK_MIN_CARDS = 10;
export const GOALS = [5, 10, 20] as const;
export type Goal = (typeof GOALS)[number];
export const DEFAULT_GOAL: Goal = 10;

export interface DayLog {
  cards: number;
  quiz: boolean;
}

export interface StreakState {
  /** Length of the streak as of `last_day`. */
  count: number;
  best: number;
  /** The last day that counted toward the streak. */
  last_day: string | null;
}

export interface Activity {
  version: 1;
  goal: Goal;
  days: Record<string, DayLog>;
  streak: StreakState;
  /** Made-up history for demos. Kept apart from the real log so removing it leaves nothing behind. */
  sample: Record<string, DayLog> | null;
}

export const emptyActivity = (): Activity => ({
  version: 1,
  goal: DEFAULT_GOAL,
  days: {},
  streak: { count: 0, best: 0, last_day: null },
  sample: null,
});

// ---- dates ----------------------------------------------------------------------------------------------

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const pad = (n: number) => String(n).padStart(2, "0");

function parts(date: string): [number, number, number] {
  const [y, m, d] = date.split("-").map(Number);
  return [y, m, d];
}

/** Whole days from a to b (negative if b is earlier). Uses UTC arithmetic so daylight saving can't skew it. */
export function daysBetween(a: string, b: string): number {
  const [ya, ma, da] = parts(a);
  const [yb, mb, db] = parts(b);
  return Math.round((Date.UTC(yb, mb - 1, db) - Date.UTC(ya, ma - 1, da)) / 86_400_000);
}

export function addDays(date: string, n: number): string {
  const [y, m, d] = parts(date);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

/** 0 for Monday through 6 for Sunday. */
export function mondayIndex(date: string): number {
  const [y, m, d] = parts(date);
  return (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
}

// ---- the streak -----------------------------------------------------------------------------------------

/** A day counts toward the streak once 10 cards are done and a quiz is finished. */
export const dayCounts = (day: DayLog | undefined): boolean => !!day && day.cards >= STREAK_MIN_CARDS && day.quiz;

/**
 * Moves the streak forward for a day that has just qualified.
 * Same day: nothing. Next day: +1. A gap of two or more days: back to 1. A clock moved backwards: nothing.
 */
export function advanceStreak(streak: StreakState, date: string): StreakState {
  if (streak.last_day === null) return { count: 1, best: Math.max(streak.best, 1), last_day: date };
  const gap = daysBetween(streak.last_day, date);
  if (gap <= 0) return streak;
  const count = gap === 1 ? streak.count + 1 : 1;
  return { count, best: Math.max(streak.best, count), last_day: date };
}

function settle(activity: Activity, date: string): Activity {
  return dayCounts(activity.days[date]) ? { ...activity, streak: advanceStreak(activity.streak, date) } : activity;
}

/** A card was finished (Got it, Again, or auto-play moved past it). */
export function recordCard(activity: Activity, date: string): Activity {
  const day = activity.days[date] ?? { cards: 0, quiz: false };
  return settle({ ...activity, days: { ...activity.days, [date]: { ...day, cards: day.cards + 1 } } }, date);
}

/** A quiz was finished. */
export function recordQuiz(activity: Activity, date: string): Activity {
  const day = activity.days[date] ?? { cards: 0, quiz: false };
  return settle({ ...activity, days: { ...activity.days, [date]: { ...day, quiz: true } } }, date);
}

/**
 * The streak to show today. If the last counting day was today or yesterday it is still alive; after a
 * gap of two or more days it has lapsed and shows 0 (the next counting day starts it again at 1).
 */
export function displayStreak(activity: Activity, today: string): number {
  const { last_day, count } = activity.streak;
  if (last_day === null) return 0;
  return daysBetween(last_day, today) > 1 ? 0 : count;
}

export function todayProgress(activity: Activity, today: string): { cards: number; quiz: boolean; counts: boolean } {
  const day = activity.days[today] ?? { cards: 0, quiz: false };
  return { cards: day.cards, quiz: day.quiz, counts: dayCounts(day) };
}

// ---- sample history (for demos) -----------------------------------------------------------------------

// Cards per day, newest first, for the 35 days before today. The five most recent days are a streak.
const SAMPLE_CARDS = [
  11, 14, 10, 12, 13, 0, 8, 10, 0, 6, 12, 9, 0, 5, 14, 10, 7, 0, 11, 9, 4, 13, 0, 8, 10, 6, 0, 12, 7, 9, 5, 0, 10, 8, 11,
];

/** Made-up history for the 35 days before `today`. Clearly labelled in the app; never mixed into the real log. */
export function sampleHistory(today: string): Record<string, DayLog> {
  const days: Record<string, DayLog> = {};
  SAMPLE_CARDS.forEach((cards, i) => {
    if (cards > 0) days[addDays(today, -(i + 1))] = { cards, quiz: cards >= 8 };
  });
  return days;
}

/** Consecutive counting days in sample history, going back from yesterday. */
export function sampleStreak(sample: Record<string, DayLog>, today: string): number {
  let count = 0;
  for (let d = addDays(today, -1); dayCounts(sample[d]); d = addDays(d, -1)) count++;
  return count;
}

// ---- heatmap ------------------------------------------------------------------------------------------

export interface HeatCell {
  date: string;
  cards: number;
  quiz: boolean;
  counts: boolean;
  future: boolean;
  isToday: boolean;
}

/** Whole weeks, Monday first, ending with the current week. Days after today are marked as future. */
export function heatmapRows(days: Record<string, DayLog>, today: string, weeks = 5): HeatCell[][] {
  const start = addDays(today, -(mondayIndex(today) + (weeks - 1) * 7));
  return Array.from({ length: weeks }, (_, w) =>
    Array.from({ length: 7 }, (_, d) => {
      const date = addDays(start, w * 7 + d);
      const day = days[date];
      return {
        date,
        cards: day?.cards ?? 0,
        quiz: day?.quiz ?? false,
        counts: dayCounts(day),
        future: date > today,
        isToday: date === today,
      };
    }),
  );
}

// ---- reading saved data safely -----------------------------------------------------------------------

const isDate = (x: unknown): x is string => typeof x === "string" && DATE_RE.test(x);

function sanitizeDays(raw: unknown): Record<string, DayLog> {
  const days: Record<string, DayLog> = {};
  if (!raw || typeof raw !== "object") return days;
  for (const [date, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!isDate(date) || !value || typeof value !== "object") continue;
    const { cards, quiz } = value as { cards?: unknown; quiz?: unknown };
    if (typeof cards !== "number" || !Number.isFinite(cards) || cards < 0) continue;
    days[date] = { cards: Math.min(Math.floor(cards), 10_000), quiz: quiz === true };
  }
  return days;
}

/** Turns anything read from storage into a valid Activity. Bad parts fall back to defaults. */
export function parseActivity(raw: unknown): Activity {
  const base = emptyActivity();
  if (!raw || typeof raw !== "object") return base;
  const r = raw as Record<string, unknown>;
  const streak = (r.streak ?? {}) as Record<string, unknown>;
  const count = typeof streak.count === "number" && streak.count >= 0 ? Math.floor(streak.count) : 0;
  const best = typeof streak.best === "number" && streak.best >= 0 ? Math.floor(streak.best) : 0;
  const lastDay = isDate(streak.last_day) ? streak.last_day : null;
  return {
    version: 1,
    goal: (GOALS as readonly unknown[]).includes(r.goal) ? (r.goal as Goal) : DEFAULT_GOAL,
    days: sanitizeDays(r.days),
    // A streak with no last day makes no sense, so it is dropped as a whole.
    streak: lastDay ? { count, best: Math.max(best, count), last_day: lastDay } : base.streak,
    sample: r.sample && typeof r.sample === "object" ? sanitizeDays(r.sample) : null,
  };
}
