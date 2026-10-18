// Mirrors the shapes the Next.js app sends over the bridge (lib/extension/protocol.ts). Kept as a
// plain, decoupled copy (not a shared package) since the extension builds separately from the app.
// There is deliberately no API key anywhere in here: the extension never holds one.

export interface SyncedProfile {
  fullName: string;
  email: string;
  phone: string;
  location: string;
  linkedin: string;
  github: string;
  portfolio: string;
  school: string;
  degreeType: string;
  major: string;
  minor: string;
  graduation: string;
  gpa: string;
  authorizedToWorkUS: "yes" | "no" | "";
  requiresSponsorship: "yes" | "no" | "";
  visaStatus: string;
  gender: string;
  race: string;
  veteran: string;
  disability: string;
  salaryExpectation: string;
  earliestStart: string;
  willingToRelocate: "yes" | "no" | "";
}

export interface SyncedAnswer {
  question: string;
  answer: string;
  tags: string[];
}

/** One role from "Your experience" (the master profile), parsed by the app. */
export interface SyncedExperience {
  title: string;
  company: string;
  location: string;
  /** As written, e.g. "May 2026 - Aug 2026" or "Jun 2025 - Present". */
  dates: string;
  /** The master profile section it's under ("Experience", "Projects"...). */
  section: string;
  bullets: string[];
}

/** One tracker job, just enough to recognize its application page. */
export interface SyncedJob {
  id: number;
  company: string;
  role: string;
  url: string;
  stage: string;
}

export interface SyncedData {
  profile: SyncedProfile;
  answerBank: SyncedAnswer[];
  /** "Your experience" as plain text. */
  masterProfile: string;
  experiences: SyncedExperience[];
  jobs: SyncedJob[];
  updatedAt: number;
}

export const BLANK_PROFILE: SyncedProfile = {
  fullName: "",
  email: "",
  phone: "",
  location: "",
  linkedin: "",
  github: "",
  portfolio: "",
  school: "",
  degreeType: "",
  major: "",
  minor: "",
  graduation: "",
  gpa: "",
  authorizedToWorkUS: "",
  requiresSponsorship: "",
  visaStatus: "",
  gender: "",
  race: "",
  veteran: "",
  disability: "",
  salaryExpectation: "",
  earliestStart: "",
  willingToRelocate: "",
};

export const BLANK_SYNCED_DATA: SyncedData = {
  profile: BLANK_PROFILE,
  answerBank: [],
  masterProfile: "",
  experiences: [],
  jobs: [],
  updatedAt: 0,
};

/** One field the fill engine acted on (or decided not to), for the "filled 14, needs you 3"
 * review checklist. Never includes a submit control. */
export interface FillOutcome {
  label: string;
  status: "filled" | "skipped-no-data" | "skipped-needs-review" | "skipped-unmatched";
  reason?: string;
}
