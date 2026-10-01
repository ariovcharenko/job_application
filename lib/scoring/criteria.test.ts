import { beforeAll, describe, expect, it } from "vitest";
import { DEFAULT_PREFERENCES, DEFAULT_PROFILE } from "../defaults";
import { candidateFacts, UNKNOWN_CANDIDATE, type CandidateFacts } from "../eligibility/candidate";
import { loadGeo } from "../geo/index";
import type { Preferences, Profile } from "../types";
import { evaluateCriteria, type Criterion } from "./criteria";
import type { JobSignals } from "./signals";

function signals(o: Partial<JobSignals> = {}): JobSignals {
  return {
    company: "Acme",
    role: "Software Engineer, New Grad",
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
    ...o,
  };
}

const person = (o: Partial<Profile>): CandidateFacts => candidateFacts({ ...DEFAULT_PROFILE, ...o });
/** An international student on OPT who needs sponsorship later, with a bachelor's. */
const OPT_STUDENT = person({ requiresSponsorship: "yes", visaStatus: "F-1 OPT", degreeType: "Bachelor's degree" });
const CITIZEN = person({ requiresSponsorship: "no", visaStatus: "US citizen", degreeType: "Bachelor of Science (B.S.)" });

const PREFS: Preferences = {
  ...DEFAULT_PREFERENCES,
  experienceLevel: "new-grad",
  workModes: ["Remote", "Hybrid"],
  locations: ["metro:oc", "metro:la", "remote-us"],
};

const find = (list: Criterion[], key: Criterion["key"]) => list.find((c) => c.key === key);
const status = (list: Criterion[], key: Criterion["key"]) => find(list, key)?.status;
const run = (o: Partial<JobSignals> = {}, candidate: CandidateFacts = OPT_STUDENT, prefs: Preferences = PREFS, skills: { have: string[]; gap: string[] } | null = null) =>
  evaluateCriteria(signals(o), prefs, skills, candidate);

beforeAll(async () => {
  await loadGeo();
});

describe("work authorization rows", () => {
  it("never treats a silent posting as a yes for sponsorship or OPT", () => {
    const c = run();
    expect(status(c, "sponsorship")).toBe("unknown");
    expect(status(c, "opt")).toBe("unknown");
  });

  it("fails OPT when the posting rules out future sponsorship, and quotes it", () => {
    const c = run({ optSignal: "excludes-opt", optEvidence: "Must be authorized to work without sponsorship now or in the future" });
    expect(status(c, "opt")).toBe("fail");
    expect(find(c, "opt")!.detail).toContain("now or in the future");
  });

  it("omits sponsorship and OPT rows entirely for someone who doesn't need sponsorship", () => {
    const c = run({ visaSignal: "no-sponsorship", optSignal: "excludes-opt" }, CITIZEN);
    expect(find(c, "sponsorship")).toBeUndefined();
    expect(find(c, "opt")).toBeUndefined();
  });

  it("checks OPT only for someone on a student visa", () => {
    const h1b = person({ requiresSponsorship: "yes", visaStatus: "H-1B" });
    const c = run({ visaSignal: "no-sponsorship" }, h1b);
    expect(status(c, "sponsorship")).toBe("fail");
    expect(find(c, "opt")).toBeUndefined();
  });

  it("never passes when the sponsorship question is unanswered, and says where to answer it", () => {
    for (const visaSignal of ["sponsors", "opt-friendly", "no-sponsorship", "unknown"] as const) {
      const row = find(run({ visaSignal }, UNKNOWN_CANDIDATE), "sponsorship")!;
      expect(row.status).toBe("unknown");
      expect(row.detail).toContain("Will you require sponsorship?");
    }
  });

  it("checks a citizenship requirement against her visa status", () => {
    expect(status(run({ citizenshipRequired: true }, CITIZEN), "citizenship")).toBe("pass");
    expect(status(run({ citizenshipRequired: true }, OPT_STUDENT), "citizenship")).toBe("fail");
    expect(status(run({ citizenshipRequired: true }, UNKNOWN_CANDIDATE), "citizenship")).toBe("unknown");
    expect(status(run({}, UNKNOWN_CANDIDATE), "citizenship")).toBe("pass");
  });

  it("fails a clearance requirement in its own row", () => {
    expect(status(run({ clearanceRequired: true }), "clearance")).toBe("fail");
    expect(status(run({ clearanceRequired: true }), "citizenship")).toBe("pass");
    expect(status(run(), "clearance")).toBe("pass");
  });
});

describe("location row", () => {
  it("checks location against her locations and work styles", () => {
    expect(status(run(), "location")).toBe("pass");
    expect(status(run({ workMode: "Hybrid", location: "Irvine, CA" }), "location")).toBe("pass");
    // In her area but a work style she hasn't selected.
    expect(status(run({ workMode: "On-site", location: "Irvine, CA" }), "location")).toBe("fail");
    expect(status(run({ workMode: "Unknown", location: "Irvine, CA" }), "location")).toBe("unknown");
    expect(status(run({ workMode: "Hybrid", location: "Austin, TX" }), "location")).toBe("fail");
    expect(status(run({ workMode: "Remote", location: "Remote (Canada)" }), "location")).toBe("fail");
  });

  it("passes an unstated work style in her area when she accepts every work style", () => {
    const all = { ...PREFS, workModes: ["Remote", "Hybrid", "On-site"] as Preferences["workModes"] };
    expect(status(run({ workMode: "Unknown", location: "Irvine, CA" }, OPT_STUDENT, all), "location")).toBe("pass");
  });

  it("treats a hybrid or on-site job with no stated location as unclear, not a fail", () => {
    const c = run({ workMode: "Hybrid", location: "" });
    expect(status(c, "location")).toBe("unknown");
    expect(find(c, "location")!.detail).toContain("Location not stated");
    expect(status(run({ workMode: "On-site", location: "" }), "location")).toBe("fail");
  });

  it("is unknown, never a pass, until she chooses locations", () => {
    const none = { ...PREFS, locations: [] };
    const row = find(run({}, OPT_STUDENT, none), "location")!;
    expect(row.status).toBe("unknown");
    expect(row.detail).toContain("Choose your locations");
  });

  it("fails a hybrid Denver job, with a reason, when she chose only Remote (US)", () => {
    const remoteOnly = { ...PREFS, locations: ["remote-us"], workModes: ["Remote", "Hybrid"] as Preferences["workModes"] };
    const row = find(run({ workMode: "Hybrid", location: "Denver, CO" }, OPT_STUDENT, remoteOnly), "location")!;
    expect(row.status).toBe("fail");
    expect(row.detail).toMatch(/Remote \(US\) is your only location/);
  });
});

describe("experience and degree rows", () => {
  it("grades experience for a new grad", () => {
    expect(status(run({ minYearsExperience: 0 }), "experience")).toBe("pass");
    expect(status(run({ minYearsExperience: 2 }), "experience")).toBe("unknown");
    expect(status(run({ minYearsExperience: 5 }), "experience")).toBe("fail");
    expect(status(run({ role: "Senior Software Engineer", seniority: "Senior" }), "experience")).toBe("fail");
  });

  it("is unknown until she sets her level", () => {
    expect(find(run({ minYearsExperience: 0 }, OPT_STUDENT, { ...PREFS, experienceLevel: "" }), "experience")!.detail).toContain("Set your experience level");
  });

  it("compares the required degree with hers", () => {
    expect(status(run({ degreeRequired: "masters" }), "degree")).toBe("fail");
    expect(status(run({ degreeRequired: "bachelors" }), "degree")).toBe("pass");
    expect(status(run({ degreeRequired: "masters" }, person({ degreeType: "Master of Science (M.S.)" })), "degree")).toBe("pass");
    expect(status(run({ degreeRequired: "bachelors" }, UNKNOWN_CANDIDATE), "degree")).toBe("unknown");
    expect(status(run({ degreeRequired: "none" }, UNKNOWN_CANDIDATE), "degree")).toBe("pass");
  });
});

describe("skills and role rows", () => {
  it("grades required skills by the share she has, and lists what's missing", () => {
    expect(status(run({}, OPT_STUDENT, PREFS, { have: ["React", "TS", "Jest"], gap: ["Go"] }), "skills")).toBe("pass");
    expect(status(run({}, OPT_STUDENT, PREFS, { have: ["React"], gap: ["Go", "Rust"] }), "skills")).toBe("unknown");
    const fail = run({}, OPT_STUDENT, PREFS, { have: [], gap: ["Go", "Rust", "Scala"] });
    expect(status(fail, "skills")).toBe("fail");
    expect(find(fail, "skills")!.detail).toContain("Missing: Go, Rust, Scala");
    expect(status(run(), "skills")).toBe("unknown");
  });

  it("adds a soft role note only when she picked roles", () => {
    expect(find(run(), "role")).toBeUndefined();
    const picked = { ...PREFS, targetRoles: ["Data & Analytics"] };
    const row = find(run({ role: "Software Engineer" }, OPT_STUDENT, picked), "role")!;
    expect(row.status).toBe("unknown");
    expect(row.detail).toContain("Outside the roles you picked");
    expect(status(run({ role: "Data Analyst" }, OPT_STUDENT, picked), "role")).toBe("pass");
  });
});
