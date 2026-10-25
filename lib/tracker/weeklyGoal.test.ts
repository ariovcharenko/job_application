import { describe, expect, it } from "vitest";
import { activeGoal, appliedThisWeek, appliedToday, goalOf, goalProgress, weekBounds, withGoal } from "./weeklyGoal";

describe("weekBounds", () => {
  it("runs Monday to Sunday", () => {
    expect(weekBounds(new Date(2026, 9, 14, 9))).toEqual({ start: "2026-10-12", end: "2026-10-18" }); // Wednesday
    expect(weekBounds(new Date(2026, 9, 12, 0, 5))).toEqual({ start: "2026-10-12", end: "2026-10-18" }); // Monday
    expect(weekBounds(new Date(2026, 9, 18, 23, 59))).toEqual({ start: "2026-10-12", end: "2026-10-18" }); // Sunday night
  });

  it("crosses month and year ends", () => {
    expect(weekBounds(new Date(2026, 11, 31))).toEqual({ start: "2026-12-28", end: "2027-01-03" });
  });
});

describe("appliedThisWeek", () => {
  const now = new Date(2026, 9, 14, 12);
  it("counts applied dates inside this week only", () => {
    const apps = [
      { stage: "Applied" as const, appliedDate: "2026-10-12" },
      { stage: "Waiting for interview" as const, appliedDate: "2026-10-18" },
      { stage: "Applied" as const, appliedDate: "2026-10-11" },
      { stage: "Applied" as const, appliedDate: "2026-10-19" },
      { stage: "Applied" as const, appliedDate: "" },
      { stage: "Saved" as const, appliedDate: "2026-10-13" },
      { stage: "Applied" as const, appliedDate: "2026-10-13", triage: "skipped" as const },
    ];
    expect(appliedThisWeek(apps, now)).toBe(2);
  });
});

describe("goalOf", () => {
  it("treats missing, zero and nonsense as off", () => {
    expect(goalOf(undefined)).toBeNull();
    expect(goalOf(0)).toBeNull();
    expect(goalOf(-3)).toBeNull();
    expect(goalOf(Number.NaN)).toBeNull();
    expect(goalOf(15)).toBe(15);
  });
});

describe("daily goal", () => {
  const now = new Date(2026, 9, 14, 12);
  const apps = [
    { stage: "Applied" as const, appliedDate: "2026-10-14" },
    { stage: "Rejected" as const, appliedDate: "2026-10-14" },
    { stage: "Applied" as const, appliedDate: "2026-10-13" },
    { stage: "Saved" as const, appliedDate: "2026-10-14" },
    { stage: "Applied" as const, appliedDate: "2026-10-14", triage: "skipped" as const },
  ];

  it("counts only today's applied dates", () => {
    expect(appliedToday(apps, now)).toBe(2);
    expect(goalProgress(apps, "day", now)).toBe(2);
    expect(goalProgress(apps, "week", now)).toBe(3);
  });

  it("picks the daily goal first, then the weekly one, else none", () => {
    expect(activeGoal({})).toBeNull();
    expect(activeGoal({ weeklyGoal: 15 })).toEqual({ count: 15, per: "week" });
    expect(activeGoal({ dailyGoal: 5, weeklyGoal: 15 })).toEqual({ count: 5, per: "day" });
    expect(activeGoal({ dailyGoal: 0, weeklyGoal: 15 })).toEqual({ count: 15, per: "week" });
  });

  it("stores one period and clears the other", () => {
    expect(withGoal({ weeklyGoal: 15 }, 5, "day")).toEqual({ dailyGoal: 5, weeklyGoal: undefined });
    expect(withGoal({ dailyGoal: 5 }, 20, "week")).toEqual({ weeklyGoal: 20, dailyGoal: undefined });
    expect(withGoal({ dailyGoal: 5 }, 0, "day")).toEqual({ dailyGoal: undefined, weeklyGoal: undefined });
    expect(withGoal({} as { dailyGoal?: number }, 999, "day").dailyGoal).toBe(50);
  });
});
