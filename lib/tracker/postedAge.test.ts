import { describe, expect, it } from "vitest";
import { daysFromEvidence, postedAge, postedLabel } from "./postedAge";

const DAY = 24 * 60 * 60 * 1000;
const CHECKED = new Date(2026, 9, 10, 12).getTime(); // Oct 10, 2026, local noon

describe("daysFromEvidence", () => {
  it("reads relative wording", () => {
    expect(daysFromEvidence("Posted 3 days ago", CHECKED)).toEqual({ days: 3, atLeast: false });
    expect(daysFromEvidence("Posted 2 weeks ago", CHECKED)).toEqual({ days: 14, atLeast: false });
    expect(daysFromEvidence("30+ days ago", CHECKED)).toEqual({ days: 30, atLeast: true });
    expect(daysFromEvidence("Posted 5 hours ago", CHECKED)).toEqual({ days: 0, atLeast: false });
    expect(daysFromEvidence("Posted Today", CHECKED)).toEqual({ days: 0, atLeast: false });
    expect(daysFromEvidence("posted yesterday", CHECKED)).toEqual({ days: 1, atLeast: false });
  });

  it("reads dates, with or without a year", () => {
    expect(daysFromEvidence("Posted on Oct 3, 2026", CHECKED)?.days).toBe(7);
    expect(daysFromEvidence("Date posted: September 30", CHECKED)?.days).toBe(10);
    expect(daysFromEvidence("2026-10-08", CHECKED)?.days).toBe(2);
  });

  it("ignores text that says nothing usable, and future dates", () => {
    expect(daysFromEvidence("", CHECKED)).toBeNull();
    expect(daysFromEvidence("Apply now", CHECKED)).toBeNull();
    expect(daysFromEvidence("Posted on Dec 25, 2026", CHECKED)).toBeNull();
  });
});

describe("postedAge", () => {
  it("adds the days since the check to the quoted age", () => {
    expect(postedAge({ freshness: "within_week", freshnessEvidence: "Posted 2 days ago" }, CHECKED, CHECKED + 3 * DAY)).toEqual({ days: 5, atLeast: false });
  });

  it("falls back to the freshness bucket", () => {
    expect(postedAge({ freshness: "within_24h", freshnessEvidence: "" }, CHECKED, CHECKED)).toEqual({ days: 0, atLeast: false });
    expect(postedAge({ freshness: "within_week", freshnessEvidence: "" }, CHECKED, CHECKED)).toEqual({ days: 1, atLeast: true });
    expect(postedAge({ freshness: "older", freshnessEvidence: "" }, CHECKED, CHECKED + 10 * DAY)).toEqual({ days: 18, atLeast: true });
  });

  it("is null when unknown or never checked", () => {
    expect(postedAge({ freshness: "unknown", freshnessEvidence: "" }, CHECKED, CHECKED)).toBeNull();
    expect(postedAge(undefined, CHECKED, CHECKED)).toBeNull();
  });
});

describe("postedLabel", () => {
  it("reads naturally", () => {
    expect(postedLabel({ days: 0, atLeast: false })).toBe("Posted today");
    expect(postedLabel({ days: 1, atLeast: false })).toBe("Posted yesterday");
    expect(postedLabel({ days: 2, atLeast: false })).toBe("Posted 2 days ago");
    expect(postedLabel({ days: 20, atLeast: false })).toBe("Posted 2 weeks ago");
    expect(postedLabel({ days: 75, atLeast: false })).toBe("Posted 2 months ago");
    expect(postedLabel({ days: 1, atLeast: true })).toBe("Posted this week");
    expect(postedLabel({ days: 8, atLeast: true })).toBe("Posted over 8 days ago");
    expect(postedLabel({ days: 30, atLeast: true })).toBe("Posted over 4 weeks ago");
    expect(postedLabel(null)).toBeNull();
  });
});
