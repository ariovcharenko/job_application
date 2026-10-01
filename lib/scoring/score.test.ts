import { beforeAll, describe, expect, it } from "vitest";
import { DEFAULT_PREFERENCES, DEFAULT_PROFILE } from "../defaults";
import { candidateFacts } from "../eligibility/candidate";
import { loadGeo } from "../geo/index";
import type { Preferences } from "../types";
import { scoreJob } from "./score";
import type { JobSignals } from "./signals";

function signals(overrides: Partial<JobSignals> = {}): JobSignals {
  return {
    company: "Acme",
    role: "Software Engineer",
    location: "Remote (US)",
    workMode: "Remote",
    salary: "",
    seniority: "New grad",
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
    minYearsExperience: -1,
    degreeRequired: "none",
    ...overrides,
  };
}

// A new grad who takes remote and hybrid jobs in Orange County / LA.
function prefs(overrides: Partial<Preferences> = {}): Preferences {
  return {
    ...DEFAULT_PREFERENCES,
    experienceLevel: "new-grad",
    workModes: ["Remote", "Hybrid"],
    locations: ["remote-us", "metro:oc", "metro:la"],
    ...overrides,
  };
}

const OPT_STUDENT = candidateFacts({ ...DEFAULT_PROFILE, requiresSponsorship: "yes", visaStatus: "F-1 OPT", degreeType: "Bachelor's degree" });
const CITIZEN = candidateFacts({ ...DEFAULT_PROFILE, requiresSponsorship: "no", visaStatus: "US citizen", degreeType: "Bachelor's degree" });

beforeAll(async () => {
  await loadGeo();
});

describe("scoreJob", () => {
  it("scores a perfect match at 100 and verdict Apply", () => {
    const p = prefs({ keywords: ["react", "typescript"], targetRoles: ["Software Engineering"] });
    const s = signals({
      role: "SWE - New Grad",
      visaSignal: "sponsors",
      workMode: "Remote",
      mustHaveSkills: ["React", "TypeScript"],
      salary: "$120,000",
      freshness: "within_24h",
    });
    const result = scoreJob(s, p);
    expect(result.rawScore).toBe(100);
    expect(result.score).toBe(100);
    expect(result.verdict).toBe("Apply");
    expect(result.cappedBy).toEqual([]);
  });

  it("caps a strong posting at 40 when it rules out sponsorship and that deal-breaker is on", () => {
    const p = prefs({ keywords: ["react"] });
    const s = signals({ visaSignal: "no-sponsorship", mustHaveSkills: ["React"], salary: "$100k", freshness: "within_24h" });
    const result = scoreJob(s, p, null, OPT_STUDENT);
    expect(result.rawScore).toBe(70); // 0 + 25(remote) + 25(match) + 10(salary) + 10(fresh)
    expect(result.score).toBe(40);
    expect(result.verdict).toBe("Skip"); // below the default 60 "maybe" floor
    expect(result.cappedBy).toContain("Posting rules out sponsorship.");
  });

  it("does not cap when the matching deal-breaker is turned off", () => {
    const p = prefs({ dealBreakers: { ...DEFAULT_PREFERENCES.dealBreakers, noSponsorship: false } });
    const s = signals({ visaSignal: "no-sponsorship" });
    const result = scoreJob(s, p);
    expect(result.score).toBe(result.rawScore);
    expect(result.cappedBy).toEqual([]);
  });

  it("caps at 40 when citizenship is required and that deal-breaker is on", () => {
    const result = scoreJob(signals({ citizenshipRequired: true, visaSignal: "sponsors" }), prefs());
    expect(result.score).toBeLessThanOrEqual(40);
    expect(result.cappedBy).toContain("Requires US citizenship.");
  });

  it("caps at 40 when a security clearance is required and that deal-breaker is on", () => {
    const result = scoreJob(signals({ clearanceRequired: true }), prefs());
    expect(result.score).toBeLessThanOrEqual(40);
    expect(result.cappedBy).toContain("Requires a security clearance.");
  });

  it("caps an on-site job outside her locations, but not one inside them", () => {
    const p = prefs({ locations: ["metro:oc"], keywords: [] });
    const outside = scoreJob(signals({ workMode: "On-site", location: "Austin, TX", visaSignal: "sponsors", salary: "x", freshness: "within_24h" }), p);
    expect(outside.score).toBeLessThanOrEqual(50);
    expect(outside.cappedBy).toContain("On-site or hybrid outside your locations.");

    const inside = scoreJob(signals({ workMode: "On-site", location: "Irvine, CA", visaSignal: "sponsors", salary: "x", freshness: "within_24h" }), p);
    expect(inside.cappedBy).toEqual([]);
    expect(inside.score).toBeGreaterThan(outside.score);
  });

  it("gives a partial location score for hybrid in an accepted region the user hasn't opted into for hybrid work", () => {
    const p = prefs({ locations: ["metro:oc"], workModes: ["Remote"] }); // Hybrid not in accepted work modes
    const result = scoreJob(signals({ workMode: "Hybrid", location: "Irvine, CA" }), p);
    const location = result.factors.find((f) => f.key === "location")!;
    expect(location.points).toBeLessThan(location.max); // 80%, not full credit
    expect(location.points).toBeGreaterThan(0);
  });

  it("treats unknown visa, work mode and freshness as neutral, not as a failure", () => {
    const result = scoreJob(signals({ workMode: "Unknown" }), prefs({ keywords: [] }));
    for (const key of ["sponsorship", "location", "match", "freshness"] as const) {
      const f = result.factors.find((x) => x.key === key)!;
      expect(f.points).toBe(Math.round(f.max * 0.5));
    }
  });

  it("never treats 'unknown' as equivalent to 'sponsors'", () => {
    const sponsors = scoreJob(signals({ visaSignal: "sponsors" }), prefs());
    const unknown = scoreJob(signals({ visaSignal: "unknown" }), prefs());
    expect(unknown.score).toBeLessThan(sponsors.score);
  });

  it("normalizes correctly even when the weights don't sum to 100", () => {
    const p = prefs({ weights: { sponsorship: 10, location: 10, match: 10, other: 10, freshness: 10 } }); // sums to 50
    const result = scoreJob(signals({ visaSignal: "sponsors", salary: "x", freshness: "within_24h" }), p);
    expect(result.rawScore).toBeGreaterThanOrEqual(0);
    expect(result.rawScore).toBeLessThanOrEqual(100);
  });

  it("counts a keyword hit fraction for the role/skills match factor", () => {
    const p = prefs({ keywords: ["react", "python", "sql"], targetRoles: [] });
    const result = scoreJob(signals({ mustHaveSkills: ["React"], role: "Backend Engineer" }), p);
    const match = result.factors.find((f) => f.key === "match")!;
    expect(match.note).toContain("1/3");
  });

  it("respects a lowered apply threshold", () => {
    const p = prefs({ applyThreshold: 50 });
    const result = scoreJob(signals({ visaSignal: "opt-friendly", salary: "x" }), p);
    expect(result.score).toBeGreaterThanOrEqual(50);
    expect(result.verdict).toBe("Apply");
  });
});

describe("scoreJob with the new eligibility signals", () => {
  it("caps a posting that rules out OPT when the no-sponsorship deal-breaker is on", () => {
    const r = scoreJob(signals({ optSignal: "excludes-opt" }), prefs(), null, OPT_STUDENT);
    expect(r.score).toBeLessThanOrEqual(40);
    expect(r.cappedBy).toContain("Rules out OPT or future sponsorship.");
  });

  it("caps experience and degree requirements above hers, from the same tables as the checklist", () => {
    expect(scoreJob(signals({ minYearsExperience: 4 }), prefs()).score).toBeLessThanOrEqual(50);
    expect(scoreJob(signals({ degreeRequired: "phd" }), prefs(), null, OPT_STUDENT).cappedBy).toContain("Requires a PhD.");
    // A mid-level candidate isn't capped by 4 years, and a PhD holder isn't capped by a PhD requirement.
    expect(scoreJob(signals({ minYearsExperience: 4, seniority: "" }), prefs({ experienceLevel: "mid" })).cappedBy).toEqual([]);
    const phd = candidateFacts({ ...DEFAULT_PROFILE, degreeType: "Doctorate (Ph.D.)" });
    expect(scoreJob(signals({ degreeRequired: "phd" }), prefs(), null, phd).cappedBy).toEqual([]);
    // An unknown degree is never a cap (and never a pass: see the checklist).
    expect(scoreJob(signals({ degreeRequired: "phd" }), prefs()).cappedBy).toEqual([]);
  });

  it("gives full work-authorization points, and no sponsorship caps, to someone who doesn't need sponsorship", () => {
    const r = scoreJob(signals({ visaSignal: "no-sponsorship", optSignal: "excludes-opt", citizenshipRequired: true }), prefs(), null, CITIZEN);
    const f = r.factors.find((x) => x.key === "sponsorship")!;
    expect(f.label).toBe("Work authorization fit");
    expect(f.points).toBe(f.max);
    expect(f.note).toBe("You don't need sponsorship.");
    expect(r.cappedBy).toEqual([]);
  });

  it("scores a remote job outside the US low", () => {
    const r = scoreJob(signals({ location: "Remote (Canada)" }), prefs());
    const f = r.factors.find((x) => x.key === "location")!;
    expect(f.points).toBeLessThan(f.max / 2);
  });

  it("uses required-skill coverage from the master profile when given", () => {
    const all = scoreJob(signals(), prefs(), { have: ["React", "Jest"], gap: [] });
    const none = scoreJob(signals(), prefs(), { have: [], gap: ["Go", "Rust"] });
    const match = (r: typeof all) => r.factors.find((f) => f.key === "match")!;
    expect(match(all).points).toBeGreaterThan(match(none).points);
    expect(match(none).note).toContain("Missing: Go, Rust");
  });
});
