import { UNKNOWN_CANDIDATE, type CandidateFacts } from "../eligibility/candidate";
import { evaluateDegree } from "../eligibility/degree";
import { evaluateExperience } from "../eligibility/experience";
import { normalizeRoleType } from "../eligibility/roles";
import { getGeo, type GeoIndex } from "../geo/index";
import { matchLocation } from "../geo/match";
import { WORK_MODES } from "../options";
import type { SkillMatch } from "../resume/master/skills";
import type { Preferences } from "../types";
import type { JobSignals } from "./signals";

// The yes/no/unknown checklist shown next to the verdict: can this candidate take the job, is it
// somewhere she'd work, and does she qualify. Deterministic, like score.ts; the AI only extracted
// the posting's signals, and everything about the candidate comes from her Profile and
// Preferences (lib/eligibility). "unknown" is never counted as a pass.

export type CriterionStatus = "pass" | "fail" | "unknown";

export type CriterionKey = "sponsorship" | "opt" | "citizenship" | "clearance" | "location" | "experience" | "degree" | "skills" | "role";

export interface Criterion {
  key: CriterionKey;
  label: string;
  status: CriterionStatus;
  detail: string;
}

/** Minimum share of the posting's required skills she must have for "skills" to pass. */
export const SKILLS_PASS_SHARE = 0.6;
const SKILLS_FAIL_SHARE = 0.3;

const ANSWER_SPONSORSHIP = 'Answer "Will you require sponsorship?" in Profile to check this.';

/** Sponsorship and OPT rows, only when they can matter for this candidate. */
function sponsorship(s: JobSignals, c: CandidateFacts): Criterion[] {
  if (c.sponsorship === "no") return [];
  const label = "Visa sponsorship";
  const quote = s.visaEvidence ? ` "${s.visaEvidence}"` : "";
  const rows: Criterion[] = [];
  if (c.sponsorship === "unknown") {
    const says =
      s.visaSignal === "no-sponsorship" ? `The posting rules out sponsorship.${quote} ` : s.visaSignal === "sponsors" ? `The posting sponsors work visas.${quote} ` : "";
    rows.push({ key: "sponsorship", label, status: "unknown", detail: `${says}${ANSWER_SPONSORSHIP}` });
  } else {
    switch (s.visaSignal) {
      case "sponsors":
        rows.push({ key: "sponsorship", label, status: "pass", detail: `Sponsors work visas.${quote}` });
        break;
      case "opt-friendly":
        rows.push({ key: "sponsorship", label, status: "pass", detail: `Welcomes OPT/CPT students.${quote}` });
        break;
      case "no-sponsorship":
        rows.push({ key: "sponsorship", label, status: "fail", detail: `Rules out sponsorship.${quote}` });
        break;
      default:
        rows.push({ key: "sponsorship", label, status: "unknown", detail: "The posting doesn't say. Not counted as a yes." });
    }
  }
  if (c.onStudentVisa) {
    const optQuote = s.optEvidence ? ` "${s.optEvidence}"` : "";
    const optLabel = "OPT / CPT";
    if (s.optSignal === "welcomes-opt") rows.push({ key: "opt", label: optLabel, status: "pass", detail: `Explicitly welcomes OPT/CPT.${optQuote}` });
    else if (s.optSignal === "excludes-opt") rows.push({ key: "opt", label: optLabel, status: "fail", detail: `Rules out OPT or future sponsorship.${optQuote}` });
    else rows.push({ key: "opt", label: optLabel, status: "unknown", detail: "The posting doesn't mention OPT. Not counted as a yes." });
  }
  return rows;
}

function citizenship(s: JobSignals, c: CandidateFacts): Criterion {
  const label = "US citizenship";
  if (!s.citizenshipRequired) return { key: "citizenship", label, status: "pass", detail: "No citizenship requirement stated." };
  if (c.isCitizen) return { key: "citizenship", label, status: "pass", detail: "Requires US citizenship, and you're a citizen." };
  if (c.visaStatusSet) return { key: "citizenship", label, status: "fail", detail: "Requires US citizenship." };
  return { key: "citizenship", label, status: "unknown", detail: "Requires US citizenship. Set your work authorization status in Profile to check this." };
}

function clearance(s: JobSignals): Criterion {
  const label = "Security clearance";
  return s.clearanceRequired
    ? { key: "clearance", label, status: "fail", detail: "Requires a security clearance." }
    : { key: "clearance", label, status: "pass", detail: "No security clearance required." };
}

function location(s: JobSignals, prefs: Preferences, geo: GeoIndex | null): Criterion {
  const label = "Location / work style";
  const is = (status: CriterionStatus, detail: string): Criterion => ({ key: "location", label, status, detail });
  if (!prefs.locations.length) return is("unknown", "Choose your locations in Preferences to check this.");
  if (!geo) return is("unknown", "Still loading place names. Check again in a moment.");

  if (s.workMode === "Remote") {
    const m = matchLocation(s.location, prefs.locations, geo, { remoteJob: true });
    return is(m.status, m.detail);
  }
  if (s.workMode !== "Unknown" && !prefs.workModes.includes(s.workMode)) {
    const where = s.location ? ` (${s.location})` : "";
    return is("fail", `${s.workMode}${where}, a work style you haven't selected.`);
  }
  const m = matchLocation(s.location, prefs.locations, geo);
  if (s.workMode !== "Unknown") return is(m.status, `${s.workMode}. ${m.detail}`);
  // Work style not stated: a place in her locations is enough only if she accepts every style.
  if (m.status === "pass" && !m.remote && !WORK_MODES.every((w) => prefs.workModes.includes(w))) {
    return is("unknown", `${m.detail} Work style not stated.`);
  }
  return is(m.status, m.status === "pass" ? m.detail : `${m.detail} Work style not stated.`);
}

function experience(s: JobSignals, prefs: Preferences): Criterion {
  const r = evaluateExperience(s, prefs.experienceLevel);
  return { key: "experience", label: "Experience level", ...r };
}

function degree(s: JobSignals, c: CandidateFacts): Criterion {
  return { key: "degree", label: "Degree", ...evaluateDegree(s.degreeRequired, c.degreeLevel) };
}

function skills(s: JobSignals, match: SkillMatch | null): Criterion {
  const label = "Required skills";
  if (!match) return { key: "skills", label, status: "unknown", detail: "Add your experience on the Resumes page to check skills." };
  const total = match.have.length + match.gap.length;
  if (total === 0) return { key: "skills", label, status: "unknown", detail: "The posting lists no specific required skills." };
  const share = match.have.length / total;
  const gapNote = match.gap.length ? ` Missing: ${match.gap.join(", ")}.` : "";
  const status: CriterionStatus = share >= SKILLS_PASS_SHARE ? "pass" : share < SKILLS_FAIL_SHARE ? "fail" : "unknown";
  return { key: "skills", label, status, detail: `You have ${match.have.length} of ${total}.${gapNote}` };
}

/** A soft note, never a must-have: is this one of the job families she picked? */
function role(s: JobSignals, prefs: Preferences): Criterion[] {
  if (!prefs.targetRoles.length) return [];
  const family = normalizeRoleType(s.role);
  const picked = new Set(prefs.targetRoles.map(normalizeRoleType));
  return picked.has(family)
    ? [{ key: "role", label: "Role", status: "pass", detail: `A ${family} role, one of the roles you picked.` }]
    : [{ key: "role", label: "Role", status: "unknown", detail: `Outside the roles you picked (${family}).` }];
}

/**
 * The checklist for one posting and one candidate. `candidate` comes from candidateFacts(profile);
 * `geo` is the place index (lib/geo), loaded by the caller (loadGeo) before this runs.
 */
export function evaluateCriteria(
  signals: JobSignals,
  prefs: Preferences,
  requiredSkills: SkillMatch | null,
  candidate: CandidateFacts = UNKNOWN_CANDIDATE,
  geo: GeoIndex | null = getGeo(),
): Criterion[] {
  return [
    ...sponsorship(signals, candidate),
    citizenship(signals, candidate),
    clearance(signals),
    location(signals, prefs, geo),
    experience(signals, prefs),
    degree(signals, candidate),
    skills(signals, requiredSkills),
    ...role(signals, prefs),
  ];
}
