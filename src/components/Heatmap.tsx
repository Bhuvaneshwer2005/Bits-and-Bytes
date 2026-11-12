import { heatmapRows, STREAK_MIN_CARDS, type HeatCell } from "../lib/activity";
import { loadSampleHistory, removeSampleHistory } from "../lib/activityStorage";
import { localDate } from "../lib/dates";
import { useStreak } from "./StreakPill";

const DAYS = [
  { short: "M", full: "Monday" },
  { short: "T", full: "Tuesday" },
  { short: "W", full: "Wednesday" },
  { short: "T", full: "Thursday" },
  { short: "F", full: "Friday" },
  { short: "S", full: "Saturday" },
  { short: "S", full: "Sunday" },
];

/** "12 November", read from the date's own year, month and day so time zones can't shift it. */
function longDate(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-GB", { day: "numeric", month: "long", timeZone: "UTC" });
}

const level = (cards: number) => (cards === 0 ? 0 : cards < 5 ? 1 : cards < STREAK_MIN_CARDS ? 2 : 3);

function cellLabel(cell: HeatCell): string {
  if (cell.future) return `${longDate(cell.date)}: not yet`;
  const cards = `${cell.cards} ${cell.cards === 1 ? "card" : "cards"}`;
  return `${longDate(cell.date)}: ${cards}${cell.quiz ? ", quiz done" : ""}${cell.counts ? ", counts toward your streak" : ""}`;
}

/**
 * Five weeks of study, Monday first. Every day shows its card count as a number, and days that count toward
 * the streak get a ring, so nothing depends on colour alone. Real activity is drawn over any sample history.
 */
export default function Heatmap({ heading = true }: { heading?: boolean }) {
  const { activity, sampleOn } = useStreak();
  const today = localDate();
  const rows = heatmapRows({ ...(activity.sample ?? {}), ...activity.days }, today);

  return (
    <section className="stack" aria-labelledby={heading ? "heat-heading" : undefined} aria-label={heading ? undefined : "Your last 5 weeks"}>
      {heading && <h2 id="heat-heading">Your last 5 weeks</h2>}

      {sampleOn && (
        <p className="notice" role="status">
          Sample data: these numbers are made up for the demo. They are not your real activity.
        </p>
      )}

      <table className="heat">
        <caption className="sr-only">
          Cards studied each day over the last five weeks. A ring marks days that count toward your streak.
        </caption>
        <thead>
          <tr>
            {DAYS.map((d, i) => (
              <th key={i} scope="col">
                <span aria-hidden="true">{d.short}</span>
                <span className="sr-only">{d.full}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, r) => (
            <tr key={r}>
              {row.map((cell) => (
                <td
                  key={cell.date}
                  className={`heat-cell heat-l${level(cell.cards)}${cell.counts ? " heat-counts" : ""}${cell.future ? " heat-future" : ""}${cell.isToday ? " heat-today" : ""}`}
                  aria-label={cellLabel(cell)}
                  aria-current={cell.isToday ? "date" : undefined}
                >
                  <span aria-hidden="true">{cell.future ? "" : cell.cards}</span>
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>

      <p className="muted">
        Numbers are cards studied that day. A ring means the day counts toward your streak ({STREAK_MIN_CARDS} cards and a finished quiz).
      </p>

      <button type="button" className="btn" onClick={sampleOn ? removeSampleHistory : () => loadSampleHistory()}>
        {sampleOn ? "Remove sample history" : "Load sample history"}
      </button>
    </section>
  );
}
