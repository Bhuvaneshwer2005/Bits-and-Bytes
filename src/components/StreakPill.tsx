import { displayStreak, sampleStreak, STREAK_MIN_CARDS, todayProgress } from "../lib/activity";
import { useActivity } from "../lib/activityStorage";
import { localDate } from "../lib/dates";

/** Today's numbers, read from the live activity store. When sample history is on, the streak shown is the sample one. */
export function useStreak() {
  const activity = useActivity();
  const today = localDate();
  const progress = todayProgress(activity, today);
  const sampleOn = activity.sample !== null;
  const count = sampleOn ? sampleStreak(activity.sample!, today) + (progress.counts ? 1 : 0) : displayStreak(activity, today);
  return { activity, today, progress, sampleOn, count };
}

export function StreakPill() {
  const { count, sampleOn } = useStreak();
  return (
    <span
      className={`pill${count > 0 ? " pill--accent" : ""}`}
      aria-label={`Current streak: ${count} ${count === 1 ? "day" : "days"}${sampleOn ? ", sample data" : ""}`}
    >
      {count}-day streak{sampleOn ? " (sample)" : ""}
    </span>
  );
}

/** What is still needed for today to count toward the streak. */
export function StreakStatus() {
  const { progress, count } = useStreak();
  if (progress.counts) return <p className="muted">Today counts toward your streak.</p>;

  const needs: string[] = [];
  const cardsLeft = STREAK_MIN_CARDS - progress.cards;
  if (cardsLeft > 0) needs.push(`${cardsLeft} more ${cardsLeft === 1 ? "card" : "cards"}`);
  if (!progress.quiz) needs.push("finish a quiz");
  return (
    <p className="muted">
      {count > 0 ? "To keep your streak today: " : "To start a streak today: "}
      {needs.join(" and ")}.
    </p>
  );
}
