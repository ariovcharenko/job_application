import { beforeAll, describe, expect, it } from "vitest";
import { DEFAULT_PROFILE } from "../defaults";
import { loadGeo } from "../geo/index";
import { decideApply } from "../intake/decision";
import { evaluateCriteria, type Criterion, type CriterionStatus } from "../scoring/criteria";
import { GOLDEN_POSTINGS } from "./__fixtures__/golden";
import { candidateFacts } from "./candidate";
import { migratePreferences } from "./migrate";

// Golden test: a typical setup before v4 (an F-1 OPT new grad, bachelor's degree,
// Orange County + LA + San Diego, remote or hybrid, every must-have on) must get the same
// pass / fail / unknown answers and the same "can apply" verdicts after migrating to the
// candidate-driven engine.
//
// EXPECTED was captured by running the pre-v4 engine (criteria.ts + decision.ts at commit 25515f1)
// on GOLDEN_POSTINGS. Order: sponsorship, opt, citizenship (then also covering clearance),
// location, experience, degree, skills. P = pass, F = fail, ? = unknown.
const EXPECTED: Record<string, [string, boolean]> = {
  remoteNewGrad: ["P?PPPPP", true],
  hybridIrvine: ["??PPPPP", true],
  onsiteIrvine: ["??PF?PP", false],
  unknownModeIrvine: ["??P??PP", true],
  hybridAustin: ["??PF?PP", false],
  unknownModeAustin: ["??PF?PP", false],
  onsiteAustin: ["??PF?PP", false],
  hybridNoLocation: ["??P??PP", true],
  onsiteNoLocation: ["??PF?PP", false],
  hybridSantaMonica: ["PPPP?PP", true],
  hybridSanDiego: ["??PP?PP", true],
  hybridGlendaleAZ: ["??PF?PP", false],
  hybridNYC: ["??PF?PP", false],
  hybridLAorRemote: ["??PP?PP", true],
  noSponsorship: ["F?PP?PP", false],
  excludesOpt: ["?FPP?PP", false],
  citizenship: ["F?FP?PP", false],
  clearance: ["??FP?PP", false],
  threeYears: ["??PPFPP", false],
  twoYears: ["??PP?PP", true],
  senior: ["??PPFPP", false],
  entryUnstated: ["??PPPPP", true],
  masters: ["??PP?FP", false],
  phd: ["??PPPFP", false],
  remoteSponsorsOpt: ["PPPPPPP", true],
  hybridCostaMesa: ["P?PPPPP", true],
};

const LETTER: Record<CriterionStatus, string> = { pass: "P", fail: "F", unknown: "?" };
const RANK: Record<CriterionStatus, number> = { fail: 0, unknown: 1, pass: 2 };

/** The new checklist in the old seven-row shape: the old citizenship row also covered clearance. */
function oldShape(c: Criterion[]): string {
  const get = (k: Criterion["key"]) => c.find((x) => x.key === k)?.status ?? "pass";
  const cit = [get("citizenship"), get("clearance")].sort((a, b) => RANK[a] - RANK[b])[0];
  return [get("sponsorship"), get("opt"), cit, get("location"), get("experience"), get("degree"), get("skills")].map((s) => LETTER[s]).join("");
}

// Her Preferences as stored before v4, run through the same migration as the database.
const OLD_STORED_PREFS = {
  id: "me",
  targetRoles: ["SWE", "AI Engineer", "Product", "UX/UI"],
  keywords: [],
  seniority: ["New grad", "Entry level"],
  workModes: ["Remote", "Hybrid"],
  regions: ["Orange County, CA", "Los Angeles, CA", "San Diego, CA"],
  companyWatchlist: ["Amazon"],
  mustHaves: { newGrad: true, bachelorsEnough: true, location: true, internationalOk: true, opt: true },
  dealBreakers: { noSponsorship: true, citizenshipRequired: true, clearanceRequired: true, locationOutsideTargets: true },
  weights: { sponsorship: 30, location: 25, match: 25, other: 10, freshness: 10 },
  applyThreshold: 75,
};

const PROFILE = { ...DEFAULT_PROFILE, requiresSponsorship: "yes" as const, visaStatus: "F-1 OPT", degreeType: "Bachelor's degree" };
const SKILLS = { have: ["React", "TypeScript", "Python"], gap: ["Go"] };

beforeAll(async () => {
  await loadGeo();
});

describe("golden: an F-1 OPT new grad's verdicts survive the migration", () => {
  const prefs = migratePreferences(OLD_STORED_PREFS);

  it("migrates her preferences to metros, remote-us, the new-grad level and the new must-haves", () => {
    expect(prefs.locations).toEqual(["metro:oc", "metro:la", "metro:san-diego", "remote-us"]);
    expect(prefs.experienceLevel).toBe("new-grad");
    expect(prefs.mustHaves).toEqual({ experience: true, degree: true, location: true, workAuth: true, clearance: true });
    expect(prefs.workModes).toEqual(["Remote", "Hybrid"]);
  });

  it.each(Object.entries(EXPECTED))("%s", (name, [statuses, canApply]) => {
    // Role families are only a soft note; drop them so the comparison is about must-haves.
    const criteria = evaluateCriteria(GOLDEN_POSTINGS[name], { ...prefs, targetRoles: [] }, SKILLS, candidateFacts(PROFILE));
    expect(oldShape(criteria)).toBe(statuses);
    expect(decideApply(criteria, prefs.mustHaves).canApply).toBe(canApply);
  });

  it("changes on purpose only where the spec asks: remote outside the US and internships now fail", () => {
    const facts = candidateFacts(PROFILE);
    const remoteCanada = { ...GOLDEN_POSTINGS.remoteNewGrad, location: "Remote (Canada)" };
    expect(evaluateCriteria(remoteCanada, prefs, SKILLS, facts).find((c) => c.key === "location")?.status).toBe("fail");
    const internship = { ...GOLDEN_POSTINGS.remoteNewGrad, role: "Software Engineering Intern", seniority: "Internship" };
    expect(evaluateCriteria(internship, prefs, SKILLS, facts).find((c) => c.key === "experience")?.detail).toBe("It's an internship.");
  });
});
