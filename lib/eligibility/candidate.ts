import type { Profile } from "../types";

// Facts about the candidate that eligibility depends on, read ONLY from what she entered in
// Profile (decision #4: the AI never guesses legal or identity answers). A blank answer stays
// "unknown", and unknown is never treated as a yes.

export type DegreeLevel = "none" | "associate" | "bachelors" | "masters" | "phd";

export interface CandidateFacts {
  /** Profile "Will you require sponsorship?": "unknown" when she hasn't answered. */
  sponsorship: "yes" | "no" | "unknown";
  /** Same as sponsorship === "yes". */
  needsSponsorship: boolean;
  /** Visa status says F-1, OPT or CPT. */
  onStudentVisa: boolean;
  /** Visa status is exactly "US citizen". */
  isCitizen: boolean;
  /** She picked any visa status at all (so "not a citizen" is known, not assumed). */
  visaStatusSet: boolean;
  degreeLevel: DegreeLevel | "unknown";
}

/** Facts for someone who has filled in nothing: everything unknown. */
export const UNKNOWN_CANDIDATE: CandidateFacts = {
  sponsorship: "unknown",
  needsSponsorship: false,
  onStudentVisa: false,
  isCitizen: false,
  visaStatusSet: false,
  degreeLevel: "unknown",
};

/** The degree level a Profile degree type means ("Master of Science (M.S.)" -> "masters"). */
export function degreeLevelOf(degreeType: string): DegreeLevel | "unknown" {
  const d = degreeType.trim();
  if (!d) return "unknown";
  if (/no degree|currently studying|high school|\bged\b/i.test(d)) return "none";
  if (/doctor|ph\.?\s?d/i.test(d)) return "phd";
  if (/master|\bmba\b|\bm\.?s\.?\b|\bm\.?eng/i.test(d)) return "masters";
  if (/bachelor|\bb\.?s\.?\b|\bb\.?a\.?\b|\bb\.?e\.?\b|\bb\.?sc/i.test(d)) return "bachelors";
  if (/associate/i.test(d)) return "associate";
  return "unknown";
}

export function candidateFacts(profile: Pick<Profile, "requiresSponsorship" | "visaStatus" | "degreeType">): CandidateFacts {
  const sponsorship = profile.requiresSponsorship === "yes" ? "yes" : profile.requiresSponsorship === "no" ? "no" : "unknown";
  const visa = profile.visaStatus.trim();
  return {
    sponsorship,
    needsSponsorship: sponsorship === "yes",
    onStudentVisa: /\bF-?1\b|\bOPT\b|\bCPT\b/i.test(visa),
    isCitizen: visa === "US citizen",
    visaStatusSet: visa !== "",
    degreeLevel: degreeLevelOf(profile.degreeType),
  };
}
