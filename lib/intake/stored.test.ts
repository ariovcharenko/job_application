import { describe, expect, it } from "vitest";
import { blankApplication } from "../tracker/blank";
import type { Application } from "../types";
import { DEFAULT_PREFERENCES } from "../defaults";
import type { Criterion } from "../scoring/criteria";
import { DEFAULT_PROFILE } from "../defaults";
import { loadGeo } from "../geo/index";
import type { JobSignals } from "../scoring/signals";
import type { Preferences } from "../types";
import { assessJob, toStoredBreakdown } from "./analyze";
import { readBreakdown, readyToApply, refreshBreakdowns, refreshStoredAnalyses } from "./stored";

const app = (o: Partial<Application>, breakdown?: object): Application => ({
  ...blankApplication(),
  ...o,
  fitBreakdown: breakdown ? JSON.stringify(breakdown) : undefined,
});
const ok = (percent: number | null) => ({ decision: { canApply: true }, skills: percent === null ? null : { percent } });

describe("readBreakdown", () => {
  it("returns null for missing or broken JSON", () => {
    expect(readBreakdown({ fitBreakdown: undefined })).toBeNull();
    expect(readBreakdown({ fitBreakdown: "{nope" })).toBeNull();
  });
});

describe("readyToApply", () => {
  it("lists saved jobs that pass every must-have, best skills match first", () => {
    const list = readyToApply([
      app({ company: "A", stage: "Saved" }, ok(60)),
      app({ company: "B", stage: "Saved" }, ok(90)),
      app({ company: "C", stage: "Saved" }, { decision: { canApply: false }, skills: { percent: 99 } }),
      app({ company: "D", stage: "Applied" }, ok(95)),
      app({ company: "E", stage: "Saved" }),
      app({ company: "F", stage: "Saved" }, ok(null)),
    ]);
    expect(list.map((x) => x.app.company)).toEqual(["B", "A", "F"]);
    // A weak match isn't "ready", even when every must-have passes.
    expect(readyToApply([app({ company: "W", stage: "Saved" }, ok(10))])).toEqual([]);
    // A job scored from a page shell instead of the posting isn't "ready".
    expect(readyToApply([app({ company: "G", stage: "Saved", jdText: "Careers Home Sign in" }, ok(90))])).toEqual([]);
  });
});

describe("refreshBreakdowns", () => {
  const criteria: Criterion[] = [{ key: "degree", label: "Degree", status: "fail", detail: "Requires a master's degree." }];
  const stored = { decision: { canApply: true, filters: [], failed: [], unclear: [] }, criteria, skills: { percent: null, required: { have: [], gap: [] }, preferred: { have: [], gap: [] } } };

  it("re-applies her current must-haves to the saved checklist", () => {
    const [changed] = refreshBreakdowns([app({ company: "A" }, stored)], DEFAULT_PREFERENCES.mustHaves, "");
    expect(JSON.parse(changed.fitBreakdown).decision.canApply).toBe(false);
    const off = { ...DEFAULT_PREFERENCES.mustHaves, degree: false };
    expect(JSON.parse(refreshBreakdowns([app({ company: "A" }, stored)], off, "")[0].fitBreakdown).decision.canApply).toBe(true);
  });

  it("fills in a match from the technologies the posting mentions when it listed no skills", () => {
    const jd = "You will build features in Swift and Objective-C, with some Python tooling. Experience with C++ is a plus.";
    const master = "### Skills\n- Languages: Python, TypeScript";
    const [changed] = refreshBreakdowns([app({ company: "A", jdText: jd }, stored)], DEFAULT_PREFERENCES.mustHaves, master);
    const skills = JSON.parse(changed.fitBreakdown).skills;
    expect(skills.basis).toBe("mentioned");
    expect(skills.required.have).toEqual(["Python"]);
    expect([...skills.required.gap].sort()).toEqual(["C++", "Objective-C", "Swift"]);
    expect(skills.percent).toBe(25);
  });

  it("returns nothing for rows that are already current or were never analyzed", () => {
    const fresh = refreshBreakdowns([app({ company: "A" }, stored)], DEFAULT_PREFERENCES.mustHaves, "")[0];
    expect(refreshBreakdowns([{ ...app({ company: "A" }), fitBreakdown: fresh.fitBreakdown }], DEFAULT_PREFERENCES.mustHaves, "")).toEqual([]);
    expect(refreshBreakdowns([app({ company: "B" })], DEFAULT_PREFERENCES.mustHaves, "")).toEqual([]);
  });
});

describe("refreshBreakdowns and soft skills", () => {
  it("drops soft skills saved by an older analysis and recomputes the percentage", () => {
    const b = {
      decision: { canApply: true, filters: [], failed: [], unclear: [] },
      criteria: [{ key: "degree", label: "Degree", status: "pass", detail: "" }],
      skills: { percent: 13, basis: "skills", required: { have: [], gap: ["Swift", "Objective-C"] }, preferred: { have: ["communication"], gap: ["attention to detail"] } },
    };
    const [changed] = refreshBreakdowns([app({ company: "Apple" }, b)], DEFAULT_PREFERENCES.mustHaves, "");
    const skills = JSON.parse(changed.fitBreakdown).skills;
    expect(skills.preferred).toEqual({ have: [], gap: [] });
    expect(skills.percent).toBe(0);
  });
});

describe("refreshStoredAnalyses", () => {
  const signals: JobSignals = {
    company: "Acme",
    role: "Software Engineer",
    location: "Denver, CO",
    workMode: "Hybrid",
    salary: "",
    seniority: "",
    mustHaveSkills: [],
    niceToHaveSkills: [],
    visaSignal: "unknown",
    visaEvidence: "",
    citizenshipRequired: false,
    clearanceRequired: false,
    freshness: "unknown",
    freshnessEvidence: "",
    optSignal: "unknown",
    optEvidence: "",
    minYearsExperience: 4,
    degreeRequired: "bachelors",
  };
  const prefs: Preferences = { ...DEFAULT_PREFERENCES, experienceLevel: "new-grad", locations: ["metro:denver"] };
  const profile = { ...DEFAULT_PROFILE, requiresSponsorship: "no" as const, degreeType: "Bachelor's degree" };

  async function savedWith(p: Preferences) {
    const geo = await loadGeo();
    const a = assessJob(signals, p, "", "", { profile, geo });
    return app({ company: "Acme", fitScore: a.score.score }, toStoredBreakdown({ ...a, signals }));
  }
  const decisionOf = (json: string) => JSON.parse(json).decision;

  it("re-runs the whole assessment for free when her level changes", async () => {
    const saved = await savedWith(prefs);
    expect(readBreakdown(saved)?.decision?.canApply).toBe(false); // 4 years is too many for a new grad
    const [changed] = await refreshStoredAnalyses([saved], { ...prefs, experienceLevel: "mid" }, profile, "");
    expect(decisionOf(changed.fitBreakdown).canApply).toBe(true);
    expect(JSON.parse(changed.fitBreakdown).signals).toEqual(signals);
    expect(changed.fitScore).toBeGreaterThan(saved.fitScore!);
  });

  it("re-runs it when her Profile or locations change", async () => {
    const saved = await savedWith({ ...prefs, experienceLevel: "mid" });
    const [moved] = await refreshStoredAnalyses([saved], { ...prefs, experienceLevel: "mid", locations: ["metro:austin"] }, profile, "");
    expect(decisionOf(moved.fitBreakdown).failed.map((f: { key: string }) => f.key)).toEqual(["location"]);
    const [noDegree] = await refreshStoredAnalyses([saved], { ...prefs, experienceLevel: "mid" }, { ...profile, degreeType: "" }, "");
    expect(decisionOf(noDegree.fitBreakdown).unclear.map((f: { key: string }) => f.key)).toContain("degree");
  });

  it("returns nothing when nothing changed", async () => {
    const saved = await savedWith(prefs);
    expect(await refreshStoredAnalyses([saved], prefs, profile, "")).toEqual([]);
  });

  it("re-maps old rows without signals by criterion key (old clearance-in-citizenship -> clearance)", async () => {
    const old = {
      decision: { canApply: false, filters: [], failed: [], unclear: [] },
      criteria: [
        { key: "citizenship", label: "Citizenship / clearance", status: "fail", detail: "Requires a security clearance." },
        { key: "degree", label: "Degree", status: "pass", detail: "" },
      ],
      skills: null,
    };
    const [changed] = await refreshStoredAnalyses([app({ company: "Old" }, old)], { ...prefs, mustHaves: { ...prefs.mustHaves, clearance: false } }, profile, "");
    expect(decisionOf(changed.fitBreakdown).canApply).toBe(true);
    expect(changed.fitScore).toBeUndefined();
    const [blocked] = await refreshStoredAnalyses([app({ company: "Old" }, old)], prefs, profile, "");
    expect(decisionOf(blocked.fitBreakdown).failed.map((f: { key: string }) => f.key)).toEqual(["clearance"]);
  });
});
