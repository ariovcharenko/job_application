import { beforeAll, describe, expect, it } from "vitest";
import { DEFAULT_PREFERENCES, DEFAULT_PROFILE } from "../defaults";
import { loadGeo } from "../geo/index";
import { evaluateCriteria } from "../scoring/criteria";
import type { JobSignals } from "../scoring/signals";
import type { ExperienceLevel, Preferences } from "../types";
import { candidateFacts, degreeLevelOf } from "./candidate";
import { evaluateDegree } from "./degree";
import { evaluateExperience } from "./experience";
import { legacyRegionToChoice, migrateMustHaves, migratePreferences } from "./migrate";
import { withLocations, withWorkModes } from "./remoteSync";
import { migrateRoleType, normalizeRoleType } from "./roles";

describe("candidateFacts (Profile only)", () => {
  it("reads sponsorship, student visa, citizenship and degree from Profile", () => {
    expect(candidateFacts({ requiresSponsorship: "yes", visaStatus: "F-1 STEM OPT", degreeType: "Master of Science (M.S.)" })).toEqual({
      sponsorship: "yes",
      needsSponsorship: true,
      onStudentVisa: true,
      isCitizen: false,
      visaStatusSet: true,
      degreeLevel: "masters",
    });
    const blank = candidateFacts(DEFAULT_PROFILE);
    expect(blank.sponsorship).toBe("unknown");
    expect(blank.needsSponsorship).toBe(false);
    expect(blank.visaStatusSet).toBe(false);
    expect(blank.degreeLevel).toBe("unknown");
    expect(candidateFacts({ ...DEFAULT_PROFILE, visaStatus: "US citizen" }).isCitizen).toBe(true);
    expect(candidateFacts({ ...DEFAULT_PROFILE, visaStatus: "F-1 student (CPT)" }).onStudentVisa).toBe(true);
    expect(candidateFacts({ ...DEFAULT_PROFILE, visaStatus: "H-1B" }).onStudentVisa).toBe(false);
  });

  it.each([
    ["", "unknown"],
    ["No degree / currently studying", "none"],
    ["Associate degree", "associate"],
    ["Bachelor's degree", "bachelors"],
    ["Bachelor of Science (B.S.)", "bachelors"],
    ["Bachelor of Arts (B.A.)", "bachelors"],
    ["Bachelor of Engineering (B.E.)", "bachelors"],
    ["Master's degree", "masters"],
    ["Master of Business Administration (MBA)", "masters"],
    ["Doctorate (Ph.D.)", "phd"],
    ["Something else", "unknown"],
  ])("degree type %j -> %s", (type, level) => {
    expect(degreeLevelOf(type)).toBe(level);
  });
});

const job = (o: Partial<Pick<JobSignals, "role" | "seniority" | "minYearsExperience">>) => ({ role: "Software Engineer", seniority: "", minYearsExperience: -1, ...o });

describe("evaluateExperience (the level table)", () => {
  it.each<[ExperienceLevel, Partial<Pick<JobSignals, "role" | "seniority" | "minYearsExperience">>, string]>([
    // internship
    ["internship", { minYearsExperience: 0 }, "pass"],
    ["internship", { role: "Software Engineering Intern" }, "pass"],
    ["internship", { role: "Co-op, Data Engineering" }, "pass"],
    ["internship", { minYearsExperience: 1 }, "fail"],
    ["internship", { role: "Senior Software Engineer" }, "fail"],
    ["internship", { role: "Staff Engineer" }, "fail"],
    ["internship", {}, "unknown"],
    // new grad
    ["new-grad", { minYearsExperience: 0 }, "pass"],
    ["new-grad", { minYearsExperience: 1 }, "pass"],
    ["new-grad", { minYearsExperience: 2 }, "unknown"],
    ["new-grad", { minYearsExperience: 3 }, "fail"],
    ["new-grad", { role: "Senior Software Engineer" }, "fail"],
    ["new-grad", { role: "Principal Engineer" }, "fail"],
    ["new-grad", { role: "Tech Lead" }, "fail"],
    ["new-grad", { role: "Software Engineering Intern" }, "fail"],
    ["new-grad", { seniority: "Entry level" }, "pass"],
    ["new-grad", {}, "unknown"],
    // early career (1-3)
    ["early", { minYearsExperience: 3 }, "pass"],
    ["early", { minYearsExperience: 4 }, "unknown"],
    ["early", { minYearsExperience: 5 }, "fail"],
    ["early", { role: "Staff Engineer" }, "fail"],
    ["early", { role: "Principal Engineer", minYearsExperience: 2 }, "fail"],
    ["early", { role: "Senior Software Engineer" }, "unknown"],
    ["early", { role: "Senior Software Engineer", minYearsExperience: 2 }, "unknown"],
    ["early", { role: "Software Engineering Intern" }, "fail"],
    // mid (3-6)
    ["mid", { minYearsExperience: 6 }, "pass"],
    ["mid", { minYearsExperience: 7 }, "unknown"],
    ["mid", { minYearsExperience: 8 }, "fail"],
    ["mid", { role: "Principal Engineer" }, "unknown"],
    ["mid", { role: "Senior Software Engineer", minYearsExperience: 5 }, "pass"],
    // senior (6+)
    ["senior", { minYearsExperience: 12 }, "pass"],
    ["senior", { role: "Principal Engineer" }, "pass"],
    ["senior", {}, "pass"],
    ["senior", { role: "Software Engineering Intern" }, "fail"],
    // not set
    ["", { minYearsExperience: 0 }, "unknown"],
  ])("%s + %j -> %s", (level, o, expected) => {
    expect(evaluateExperience(job(o), level).status).toBe(expected);
  });

  it("explains an internship and an unset level", () => {
    expect(evaluateExperience(job({ role: "Data Intern" }), "new-grad").detail).toBe("It's an internship.");
    expect(evaluateExperience(job({}), "").detail).toContain("Set your experience level");
  });

  it("doesn't read 'Internal' or 'International' as an internship", () => {
    expect(evaluateExperience(job({ role: "Internal Tools Engineer", minYearsExperience: 1 }), "new-grad").status).toBe("pass");
    expect(evaluateExperience(job({ role: "International Payments Engineer", minYearsExperience: 0 }), "new-grad").status).toBe("pass");
  });
});

describe("evaluateDegree", () => {
  it.each([
    ["none", "unknown", "pass"],
    ["bachelors", "bachelors", "pass"],
    ["bachelors", "masters", "pass"],
    ["masters", "bachelors", "fail"],
    ["phd", "masters", "fail"],
    ["bachelors", "associate", "fail"],
    ["associate", "associate", "pass"],
    ["bachelors", "none", "fail"],
    ["bachelors", "unknown", "unknown"],
  ] as const)("requires %s, has %s -> %s", (required, has, expected) => {
    expect(evaluateDegree(required, has).status).toBe(expected);
  });
});

describe("normalizeRoleType", () => {
  it.each([
    ["ML Engineer", "AI / ML"],
    ["Machine Learning Engineer", "AI / ML"],
    ["Data Engineer", "Data & Analytics"],
    ["Data Analyst", "Data & Analytics"],
    ["Data Scientist", "Data & Analytics"],
    ["Site Reliability Engineer", "DevOps / SRE / Cloud"],
    ["DevOps Engineer", "DevOps / SRE / Cloud"],
    ["Cloud Engineer", "DevOps / SRE / Cloud"],
    ["Security Engineer", "Security"],
    ["QA Automation Engineer", "QA / Test"],
    ["SDET", "QA / Test"],
    ["iOS Engineer", "Mobile"],
    ["Android Developer", "Mobile"],
    ["Frontend Engineer", "Frontend/Web"],
    ["Front-End Developer", "Frontend/Web"],
    ["UI Engineer", "Frontend/Web"],
    ["Product Designer", "Design (UX/UI)"],
    ["UX Researcher", "Design (UX/UI)"],
    ["Associate Product Manager", "Product Management"],
    ["Firmware Engineer", "Embedded / Hardware"],
    ["IT Support Specialist", "IT / Support"],
    ["Software Engineer, New Grad", "Software Engineering"],
    ["Full Stack Developer", "Software Engineering"],
    ["Backend Engineer", "Software Engineering"],
    ["Warehouse Associate", "Other"],
    // Labels, old and new
    ["SWE", "Software Engineering"],
    ["AI Engineer", "AI / ML"],
    ["Product", "Product Management"],
    ["UX/UI", "Design (UX/UI)"],
    ["Data & Analytics", "Data & Analytics"],
  ])("%s -> %s", (title, family) => {
    expect(normalizeRoleType(title)).toBe(family);
  });

  it("migrates stored role types", () => {
    expect(migrateRoleType("SWE")).toBe("Software Engineering");
    expect(migrateRoleType("AI Engineer")).toBe("AI / ML");
    expect(migrateRoleType("Product")).toBe("Product Management");
    expect(migrateRoleType("UX/UI")).toBe("Design (UX/UI)");
    expect(migrateRoleType("Other", "Data Analyst")).toBe("Other");
    expect(migrateRoleType("Mobile")).toBe("Mobile");
    expect(migrateRoleType(undefined, "Site Reliability Engineer")).toBe("DevOps / SRE / Cloud");
  });
});

describe("migratePreferences", () => {
  it("maps each old region to its metro, and keeps a typed City, ST", () => {
    expect(
      ["Orange County, CA", "Los Angeles, CA", "San Francisco Bay Area, CA", "San Diego, CA", "Sacramento, CA", "Seattle, WA", "New York, NY", "Austin, TX", "Chicago, IL", "Boston, MA"].map(
        legacyRegionToChoice,
      ),
    ).toEqual(["metro:oc", "metro:la", "metro:sf-bay-area", "metro:san-diego", "metro:sacramento", "metro:seattle", "metro:nyc", "metro:austin", "metro:chicago", "metro:boston"]);
    expect(legacyRegionToChoice("Boise, ID")).toBe("city:boise-id");
    expect(legacyRegionToChoice("somewhere nice")).toBeNull();
  });

  it("maps the old must-haves: work auth from international or OPT, clearance from international", () => {
    expect(migrateMustHaves({ newGrad: false, bachelorsEnough: true, location: false, internationalOk: false, opt: true })).toEqual({
      experience: false,
      degree: true,
      location: false,
      workAuth: true,
      clearance: false,
    });
    expect(migrateMustHaves({ internationalOk: false, opt: false })).toMatchObject({ workAuth: false, clearance: false });
    expect(migrateMustHaves(undefined)).toEqual(DEFAULT_PREFERENCES.mustHaves);
  });

  it("adds Remote (US) only when Remote was one of her work styles", () => {
    expect(migratePreferences({ regions: ["Austin, TX"], workModes: ["Hybrid"] }).locations).toEqual(["metro:austin"]);
    expect(migratePreferences({ regions: [], workModes: ["Remote"] }).locations).toEqual(["remote-us"]);
  });

  it("returns neutral defaults for nothing stored, and is idempotent", () => {
    expect(migratePreferences(undefined)).toEqual(DEFAULT_PREFERENCES);
    const once = migratePreferences({ regions: ["Seattle, WA"], workModes: ["Remote", "Hybrid"], mustHaves: { newGrad: true } });
    expect(migratePreferences(once)).toEqual(once);
    // A user who cleared every location keeps it cleared.
    expect(migratePreferences({ ...once, locations: [] }).locations).toEqual([]);
  });
});

describe("remote sync between work styles and locations", () => {
  const base: Preferences = { ...DEFAULT_PREFERENCES, workModes: ["Remote", "Hybrid"], locations: ["remote-us", "metro:la"] };

  it("unticking Remote removes Remote (US), and ticking it adds it back", () => {
    const off = withWorkModes(base, ["Hybrid"]);
    expect(off.locations).toEqual(["metro:la"]);
    expect(withWorkModes(off, ["Hybrid", "Remote"]).locations).toEqual(["remote-us", "metro:la"]);
  });

  it("removing Remote (US) unticks Remote, and adding it ticks Remote", () => {
    const off = withLocations(base, ["metro:la"]);
    expect(off.workModes).toEqual(["Hybrid"]);
    expect(withLocations(off, ["metro:la", "remote-us"]).workModes).toEqual(["Hybrid", "Remote"]);
  });

  it("brings the Remote work style along as Remote (US) with her first location", () => {
    const fresh = withLocations(DEFAULT_PREFERENCES, ["state:TX"]);
    expect(fresh.locations).toEqual(["remote-us", "state:TX"]);
    expect(fresh.workModes).toEqual(DEFAULT_PREFERENCES.workModes);
  });
});

describe("eligibility matrix (pre-deploy QA #4, no AI calls)", () => {
  beforeAll(async () => {
    await loadGeo();
  });
  const s = (o: Partial<JobSignals>): JobSignals => ({
    company: "Acme",
    role: "Software Engineer",
    location: "Austin, TX",
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
    minYearsExperience: -1,
    degreeRequired: "none",
    ...o,
  });
  const get = (list: ReturnType<typeof evaluateCriteria>, key: string) => list.find((c) => c.key === key);

  it("US citizen, bachelor's, early career in Texas: no sponsorship rows; 4 years unclear, 5 years fails", () => {
    const citizen = candidateFacts({ ...DEFAULT_PROFILE, requiresSponsorship: "no", visaStatus: "US citizen", degreeType: "Bachelor's degree" });
    const prefs: Preferences = { ...DEFAULT_PREFERENCES, experienceLevel: "early", locations: ["state:TX"] };
    const four = evaluateCriteria(s({ minYearsExperience: 4, visaSignal: "no-sponsorship", optSignal: "excludes-opt" }), prefs, null, citizen);
    expect(get(four, "sponsorship")).toBeUndefined();
    expect(get(four, "opt")).toBeUndefined();
    expect(get(four, "experience")?.status).toBe("unknown");
    expect(get(four, "location")?.status).toBe("pass");
    expect(get(evaluateCriteria(s({ minYearsExperience: 5 }), prefs, null, citizen), "experience")?.status).toBe("fail");
  });

  it("H-1B senior, anywhere in the US: sponsorship checked, no OPT row", () => {
    const h1b = candidateFacts({ ...DEFAULT_PROFILE, requiresSponsorship: "yes", visaStatus: "H-1B", degreeType: "Master's degree" });
    const prefs: Preferences = { ...DEFAULT_PREFERENCES, experienceLevel: "senior", locations: ["us"] };
    const c = evaluateCriteria(s({ location: "Jersey City, NJ", minYearsExperience: 8, visaSignal: "sponsors", degreeRequired: "masters" }), prefs, null, h1b);
    expect(get(c, "sponsorship")?.status).toBe("pass");
    expect(get(c, "opt")).toBeUndefined();
    expect(get(c, "location")?.status).toBe("pass");
    expect(get(c, "experience")?.status).toBe("pass");
    expect(get(c, "degree")?.status).toBe("pass");
  });

  it("a blank sponsorship answer never passes", () => {
    const blank = candidateFacts(DEFAULT_PROFILE);
    const c = evaluateCriteria(s({ visaSignal: "sponsors" }), { ...DEFAULT_PREFERENCES, locations: ["us"] }, null, blank);
    expect(get(c, "sponsorship")?.status).toBe("unknown");
  });
});
