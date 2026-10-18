import { describe, expect, it } from "vitest";
import { appliedThisWeek, goalOf, weekBounds } from "./weeklyGoal";

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
