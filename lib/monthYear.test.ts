import { describe, expect, it } from "vitest";
import { formatMonthYear, parseMonthYear, yearChoices } from "./monthYear";

describe("monthYear", () => {
  it("parses YYYY-MM", () => {
    expect(parseMonthYear("2027-05")).toEqual({ month: 5, year: 2027 });
  });
  it("treats blank or malformed values as empty", () => {
    expect(parseMonthYear("")).toEqual({ month: null, year: null });
    expect(parseMonthYear("Jun 2026")).toEqual({ month: null, year: null });
    expect(parseMonthYear("2027-13").month).toBeNull();
  });
  it("formats only when both parts are set", () => {
    expect(formatMonthYear({ month: 5, year: 2027 })).toBe("2027-05");
    expect(formatMonthYear({ month: 12, year: 2026 })).toBe("2026-12");
    expect(formatMonthYear({ month: 5, year: null })).toBe("");
    expect(formatMonthYear({ month: null, year: 2027 })).toBe("");
  });
  it("offers a range of years and keeps a saved year outside it", () => {
    const years = yearChoices(new Date(2026, 8, 1));
    expect(years[0]).toBe(2024);
    expect(years).toContain(2027);
    expect(yearChoices(new Date(2026, 8, 1), 2010)).toContain(2010);
  });
});
