import { describe, expect, it } from "vitest";
import {
  addDays,
  advanceStreak,
  dayCounts,
  daysBetween,
  displayStreak,
  emptyActivity,
  heatmapRows,
  mondayIndex,
  parseActivity,
  recordCard,
  recordQuiz,
  sampleHistory,
  sampleStreak,
  todayProgress,
  type Activity,
} from "./activity";

/** Gives a day `cards` cards and, if asked, a finished quiz. */
function study(a: Activity, date: string, cards: number, quiz = true): Activity {
  let out = a;
  for (let i = 0; i < cards; i++) out = recordCard(out, date);
  return quiz ? recordQuiz(out, date) : out;
}

describe("dates", () => {
  it("counts whole days across month, year and leap-day boundaries", () => {
    expect(daysBetween("2026-11-12", "2026-11-12")).toBe(0);
    expect(daysBetween("2026-11-12", "2026-11-13")).toBe(1);
    expect(daysBetween("2026-01-31", "2026-02-01")).toBe(1);
    expect(daysBetween("2026-12-31", "2027-01-01")).toBe(1);
    expect(daysBetween("2028-02-28", "2028-03-01")).toBe(2); // 2028 is a leap year
    expect(daysBetween("2027-02-28", "2027-03-01")).toBe(1);
    expect(daysBetween("2026-11-12", "2026-11-09")).toBe(-3);
  });

  it("is not thrown off by daylight saving changes", () => {
    expect(daysBetween("2026-03-28", "2026-03-30")).toBe(2);
    expect(daysBetween("2026-10-24", "2026-10-26")).toBe(2);
  });

  it("adds and subtracts days across boundaries", () => {
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(addDays("2026-11-12", -35)).toBe("2026-10-08");
  });

  it("finds Monday as day 0", () => {
    expect(mondayIndex("2026-11-12")).toBe(3); // a Thursday
    expect(mondayIndex("2026-11-09")).toBe(0);
    expect(mondayIndex("2026-11-15")).toBe(6);
  });
});

describe("what counts as a streak day", () => {
  it("needs 10 cards AND a finished quiz", () => {
    expect(dayCounts({ cards: 10, quiz: true })).toBe(true);
    expect(dayCounts({ cards: 9, quiz: true })).toBe(false);
    expect(dayCounts({ cards: 10, quiz: false })).toBe(false);
    expect(dayCounts({ cards: 40, quiz: false })).toBe(false);
    expect(dayCounts(undefined)).toBe(false);
  });

  it("starts the streak at 1 on the first counting day, in either order", () => {
    expect(study(emptyActivity(), "2026-11-12", 10).streak).toEqual({ count: 1, best: 1, last_day: "2026-11-12" });
    const quizFirst = recordQuiz(emptyActivity(), "2026-11-12");
    expect(quizFirst.streak.count).toBe(0);
    expect(study(quizFirst, "2026-11-12", 10, false).streak.count).toBe(1);
  });

  it("does not count 9 cards, or 10 cards without a quiz", () => {
    expect(study(emptyActivity(), "2026-11-12", 9).streak.count).toBe(0);
    expect(study(emptyActivity(), "2026-11-12", 12, false).streak.count).toBe(0);
  });
});

describe("streak rules", () => {
  it("changes nothing when the same day is counted again", () => {
    let a = study(emptyActivity(), "2026-11-12", 10);
    a = study(a, "2026-11-12", 5);
    a = recordQuiz(a, "2026-11-12");
    expect(a.streak).toEqual({ count: 1, best: 1, last_day: "2026-11-12" });
    expect(a.days["2026-11-12"].cards).toBe(15);
  });

  it("adds one on the next day", () => {
    let a = study(emptyActivity(), "2026-11-12", 10);
    a = study(a, "2026-11-13", 10);
    expect(a.streak).toEqual({ count: 2, best: 2, last_day: "2026-11-13" });
  });

  it("carries on across a month end and a year end", () => {
    let a = study(emptyActivity(), "2026-01-31", 10);
    a = study(a, "2026-02-01", 10);
    expect(a.streak.count).toBe(2);
    let b = study(emptyActivity(), "2026-12-31", 10);
    b = study(b, "2027-01-01", 10);
    expect(b.streak.count).toBe(2);
  });

  it("restarts at 1 after a gap of two or more days, and remembers the best", () => {
    let a = study(emptyActivity(), "2026-11-10", 10);
    a = study(a, "2026-11-11", 10);
    a = study(a, "2026-11-12", 10);
    expect(a.streak.count).toBe(3);
    a = study(a, "2026-11-15", 10); // missed the 13th and 14th
    expect(a.streak).toEqual({ count: 1, best: 3, last_day: "2026-11-15" });
  });

  it("restarts after exactly a two-day gap, but not after a one-day step", () => {
    const base = study(emptyActivity(), "2026-11-10", 10);
    expect(study(base, "2026-11-12", 10).streak.count).toBe(1);
    expect(study(base, "2026-11-11", 10).streak.count).toBe(2);
  });

  it("changes nothing when the clock moves backwards", () => {
    let a = study(emptyActivity(), "2026-11-12", 10);
    a = study(a, "2026-11-13", 10);
    const before = a.streak;
    a = study(a, "2026-11-10", 10); // clock set back three days
    a = study(a, "2026-11-12", 10);
    expect(a.streak).toEqual(before);
    expect(advanceStreak(before, "2026-01-01")).toBe(before);
  });

  it("keeps building the streak from the latest day after a backwards step", () => {
    let a = study(emptyActivity(), "2026-11-12", 10);
    a = study(a, "2026-11-10", 10);
    a = study(a, "2026-11-13", 10);
    expect(a.streak.count).toBe(2);
  });
});

describe("displayStreak", () => {
  const withStreak = (last_day: string | null, count: number): Activity => ({ ...emptyActivity(), streak: { count, best: count, last_day } });

  it("shows the streak while the last counting day is today or yesterday", () => {
    expect(displayStreak(withStreak("2026-11-12", 4), "2026-11-12")).toBe(4);
    expect(displayStreak(withStreak("2026-11-11", 4), "2026-11-12")).toBe(4);
  });

  it("shows 0 once two or more days have passed", () => {
    expect(displayStreak(withStreak("2026-11-10", 4), "2026-11-12")).toBe(0);
    expect(displayStreak(withStreak("2026-10-01", 9), "2026-11-12")).toBe(0);
  });

  it("shows 0 with no history, and keeps the count when the clock is behind", () => {
    expect(displayStreak(emptyActivity(), "2026-11-12")).toBe(0);
    expect(displayStreak(withStreak("2026-11-14", 3), "2026-11-12")).toBe(3);
  });

  it("works across a month end", () => {
    expect(displayStreak(withStreak("2026-10-31", 2), "2026-11-01")).toBe(2);
    expect(displayStreak(withStreak("2026-10-31", 2), "2026-11-02")).toBe(0);
  });
});

describe("todayProgress", () => {
  it("reports today's cards, quiz and whether the day counts", () => {
    let a = study(emptyActivity(), "2026-11-12", 7, false);
    expect(todayProgress(a, "2026-11-12")).toEqual({ cards: 7, quiz: false, counts: false });
    a = study(a, "2026-11-12", 3);
    expect(todayProgress(a, "2026-11-12")).toEqual({ cards: 10, quiz: true, counts: true });
    expect(todayProgress(a, "2026-11-13")).toEqual({ cards: 0, quiz: false, counts: false });
  });
});

describe("reading saved data", () => {
  it("falls back to an empty log for anything that is not an object", () => {
    for (const bad of [null, undefined, 5, "text", [], true]) {
      expect(parseActivity(bad)).toEqual(emptyActivity());
    }
  });

  it("drops bad days and keeps good ones", () => {
    const a = parseActivity({
      days: {
        "2026-11-12": { cards: 7, quiz: true },
        "yesterday": { cards: 3, quiz: true },
        "2026-11-11": { cards: -4, quiz: true },
        "2026-11-10": { cards: "many", quiz: true },
        "2026-11-09": "oops",
        "2026-11-08": { cards: 2.9, quiz: "yes" },
      },
    });
    expect(a.days).toEqual({ "2026-11-12": { cards: 7, quiz: true }, "2026-11-08": { cards: 2, quiz: false } });
  });

  it("only accepts the goals 5, 10 and 20", () => {
    expect(parseActivity({ goal: 20 }).goal).toBe(20);
    expect(parseActivity({ goal: 7 }).goal).toBe(10);
    expect(parseActivity({ goal: "5" }).goal).toBe(10);
  });

  it("repairs the streak: no last day drops it, best is never below count", () => {
    expect(parseActivity({ streak: { count: 5, best: 5, last_day: "nope" } }).streak).toEqual(emptyActivity().streak);
    expect(parseActivity({ streak: { count: 5, best: 2, last_day: "2026-11-12" } }).streak).toEqual({ count: 5, best: 5, last_day: "2026-11-12" });
    expect(parseActivity({ streak: { count: -3, best: -1, last_day: "2026-11-12" } }).streak.count).toBe(0);
  });

  it("caps absurd card counts and cleans the sample history too", () => {
    expect(parseActivity({ days: { "2026-11-12": { cards: 1e9, quiz: true } } }).days["2026-11-12"].cards).toBe(10_000);
    expect(parseActivity({ sample: { "2026-11-11": { cards: 4, quiz: false }, bad: {} } }).sample).toEqual({ "2026-11-11": { cards: 4, quiz: false } });
    expect(parseActivity({ sample: "x" }).sample).toBeNull();
  });
});

describe("sample history", () => {
  const today = "2026-11-12";

  it("covers the 35 days before today, never today itself", () => {
    const s = sampleHistory(today);
    expect(s[today]).toBeUndefined();
    expect(s["2026-11-11"]).toBeDefined();
    expect(Object.keys(s).every((d) => daysBetween(d, today) >= 1 && daysBetween(d, today) <= 35)).toBe(true);
    expect(Object.keys(s).length).toBeGreaterThan(20);
  });

  it("is a five-day streak ending yesterday, followed by a missed day", () => {
    const s = sampleHistory(today);
    expect(sampleStreak(s, today)).toBe(5);
    expect(dayCounts(s[addDays(today, -6)])).toBe(false);
  });

  it("has some days with fewer than 10 cards, so the heatmap shows variety", () => {
    const values = Object.values(sampleHistory(today)).map((d) => d.cards);
    expect(values.some((n) => n < 5)).toBe(true);
    expect(values.some((n) => n >= 10)).toBe(true);
  });

  it("never touches the real log or streak", () => {
    const real = study(emptyActivity(), today, 10);
    const withSample = { ...real, sample: sampleHistory(today) };
    expect(withSample.days).toEqual(real.days);
    expect(withSample.streak).toEqual(real.streak);
  });
});

describe("heatmapRows", () => {
  const today = "2026-11-12"; // a Thursday

  it("makes five rows of seven days, Monday first, ending with this week", () => {
    const rows = heatmapRows({}, today);
    expect(rows).toHaveLength(5);
    expect(rows.every((r) => r.length === 7)).toBe(true);
    expect(rows.every((r) => mondayIndex(r[0].date) === 0)).toBe(true);
    expect(rows[4][0].date).toBe("2026-11-09");
    expect(rows[0][0].date).toBe("2026-10-12");
  });

  it("marks today and the days after it", () => {
    const last = heatmapRows({}, today)[4];
    expect(last[3].isToday).toBe(true);
    expect(last.slice(0, 4).every((c) => !c.future)).toBe(true);
    expect(last.slice(4).every((c) => c.future)).toBe(true);
  });

  it("carries each day's cards, quiz and whether it counts", () => {
    const rows = heatmapRows({ "2026-11-11": { cards: 12, quiz: true }, "2026-11-10": { cards: 4, quiz: false } }, today);
    const cell = (d: string) => rows.flat().find((c) => c.date === d)!;
    expect(cell("2026-11-11")).toMatchObject({ cards: 12, quiz: true, counts: true });
    expect(cell("2026-11-10")).toMatchObject({ cards: 4, quiz: false, counts: false });
    expect(cell("2026-11-09")).toMatchObject({ cards: 0, counts: false });
  });

  it("works when today is a Monday or a Sunday", () => {
    expect(heatmapRows({}, "2026-11-09")[4][0].isToday).toBe(true);
    expect(heatmapRows({}, "2026-11-15")[4][6].isToday).toBe(true);
    expect(heatmapRows({}, "2026-11-15")[4].every((c) => !c.future)).toBe(true);
  });

  it("works across a year end", () => {
    const rows = heatmapRows({}, "2027-01-02");
    expect(rows.flat().map((c) => c.date)).toContain("2026-12-31");
    expect(rows.flat()).toHaveLength(35);
  });
});
