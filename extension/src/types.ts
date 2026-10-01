// Mirrors the shapes the Next.js app sends over the sync bridge. Kept as a plain, decoupled copy
// (not a shared package) since the extension builds separately from the app.

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

export interface SyncedResume {
  fileName: string;
  /** Base64-encoded .docx bytes. */
  base64: string;
}

export interface SyncedData {
  profile: SyncedProfile;
  answerBank: SyncedAnswer[];
  resume: SyncedResume | null;
  anthropicKey: string;
  updatedAt: number;
}

export const BLANK_SYNCED_DATA: SyncedData = {
  profile: {
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
  },
  answerBank: [],
  resume: null,
  anthropicKey: "",
  updatedAt: 0,
};

/** One field the fill engine acted on (or decided not to), for the "filled 14, needs you 3"
 * review checklist. Never includes a submit control. */
export interface FillOutcome {
  label: string;
  status: "filled" | "skipped-no-data" | "skipped-needs-review" | "skipped-unmatched";
  reason?: string;
}
