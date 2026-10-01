import { describe, expect, it } from "vitest";
import { blankApplication } from "./blank";
import { DEFAULT_VIEW_PREFS, filterApplications, hasActiveFilters, matchesQuery, NO_FILTERS, parseViewPrefs, stageCounts } from "./filter";
import type { Application } from "../types";

const app = (id: number, patch: Partial<Application>): Application => ({ ...blankApplication(), id, ...patch });

const apps = [
  app(1, { company: "Acme Robotics", role: "Software Engineer", location: "Austin, TX", stage: "Applied", roleType: "Software Engineering" }),
  app(2, { company: "Globex", role: "Data Analyst", location: "Remote (US)", notes: "Met the team at a career fair", stage: "Saved" }),
  app(3, { company: "Initech", role: "Product Designer", location: "Denver, CO", contactName: "Sam Rivera", stage: "Rejected" }),
];

describe("matchesQuery", () => {
  it("matches company, position, location, notes and contact, ignoring case", () => {
    expect(matchesQuery(apps[0], "acme")).toBe(true);
    expect(matchesQuery(apps[0], "ENGINEER")).toBe(true);
    expect(matchesQuery(apps[0], "austin")).toBe(true);
    expect(matchesQuery(apps[1], "career fair")).toBe(true);
    expect(matchesQuery(apps[2], "rivera")).toBe(true);
  });

  it("needs every word, in any order and across fields", () => {
    expect(matchesQuery(apps[0], "austin software")).toBe(true);
    expect(matchesQuery(apps[0], "austin designer")).toBe(false);
  });

  it("treats a blank query as a match", () => {
    expect(matchesQuery(apps[0], "   ")).toBe(true);
  });
});

describe("filterApplications", () => {
  it("returns everything with no filters", () => {
    expect(filterApplications(apps, NO_FILTERS)).toHaveLength(3);
  });

  it("combines stage, role type and search", () => {
    expect(filterApplications(apps, { ...NO_FILTERS, stage: "Saved" }).map((a) => a.id)).toEqual([2]);
    expect(filterApplications(apps, { ...NO_FILTERS, roleType: "Software Engineering" }).map((a) => a.id)).toEqual([1]);
    expect(filterApplications(apps, { query: "remote", stage: "Applied", roleType: "" })).toEqual([]);
  });
});

describe("stageCounts", () => {
  it("counts every stage, including empty ones", () => {
    expect(stageCounts(apps)).toEqual({ Saved: 1, Applied: 1, "Waiting for interview": 0, Offer: 0, Rejected: 1 });
  });
});

describe("hasActiveFilters", () => {
  it("is false for the defaults and a whitespace query", () => {
    expect(hasActiveFilters(NO_FILTERS)).toBe(false);
    expect(hasActiveFilters({ ...NO_FILTERS, query: "  " })).toBe(false);
    expect(hasActiveFilters({ ...NO_FILTERS, stage: "Offer" })).toBe(true);
  });
});

describe("parseViewPrefs", () => {
  it("falls back to defaults for missing or broken data", () => {
    expect(parseViewPrefs(null)).toEqual(DEFAULT_VIEW_PREFS);
    expect(parseViewPrefs("not json")).toEqual(DEFAULT_VIEW_PREFS);
    expect(parseViewPrefs("42")).toEqual(DEFAULT_VIEW_PREFS);
  });

  it("keeps known values and drops unknown ones", () => {
    expect(parseViewPrefs(JSON.stringify({ view: "board", stage: "Offer", roleType: "Software Engineering" }))).toEqual({ view: "board", stage: "Offer", roleType: "Software Engineering" });
    expect(parseViewPrefs(JSON.stringify({ view: "grid", stage: "Interviewing", roleType: 3 }))).toEqual(DEFAULT_VIEW_PREFS);
  });
});
