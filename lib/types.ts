import type { WorkMode } from "./options";

// Shared data types. Stand-ins for the tracker fields until the user's real Notion fields are known.

export const STAGES = ["Saved", "Applied", "Waiting for interview", "Offer", "Rejected"] as const;
export type Stage = (typeof STAGES)[number];

/** Job families, for the tracker's "Role type" and "Roles I'm looking for" (lib/eligibility/roles.ts). */
export const ROLE_TYPES = [
  "Software Engineering",
  "Frontend/Web",
  "Mobile",
  "Data & Analytics",
  "AI / ML",
  "DevOps / SRE / Cloud",
  "Security",
  "QA / Test",
  "Product Management",
  "Design (UX/UI)",
  "Embedded / Hardware",
  "IT / Support",
  "Other",
] as const;
export type RoleType = (typeof ROLE_TYPES)[number];

/** How much experience a job should ask for to suit her (lib/eligibility/experience.ts). "" = not set. */
export const EXPERIENCE_LEVELS = ["internship", "new-grad", "early", "mid", "senior"] as const;
export type ExperienceLevel = (typeof EXPERIENCE_LEVELS)[number] | "";

// What the posting says about visas. "unknown" is never treated as a yes.
export const VISA_SIGNALS = ["unknown", "sponsors", "opt-friendly", "no-sponsorship"] as const;
export type VisaSignal = (typeof VISA_SIGNALS)[number];

export interface AppSettings {
  id: "app";
  provider: "anthropic";
  anthropicKey: string;
  /** Needed only when the API key is not tied to a workspace (starts with "wrkspc_"). */
  workspaceId: string;
  fastModel: string; // cheap extraction / classification / scoring signals
  smartModel: string; // tailoring, cover letters, free-text answers
  resumeFolder?: FileSystemDirectoryHandle;
  /** JSearch (RapidAPI) key, for the company-watchlist job feed. Free tier: ~200 requests/month. */
  jsearchApiKey: string;
}

export interface Profile {
  id: "me";
  fullName: string;
  email: string;
  phone: string;
  location: string;
  linkedin: string;
  github: string;
  portfolio: string;
  school: string;
  degreeType: string; // e.g. "Bachelor's degree"
  major: string;
  minor: string;
  graduation: string; // "YYYY-MM"
  gpa: string;
  // Legal / identity answers. Autofill uses ONLY these; the AI never guesses them.
  authorizedToWorkUS: "yes" | "no" | "";
  requiresSponsorship: "yes" | "no" | "";
  visaStatus: string; // free text, e.g. "F-1 OPT"
  gender: string;
  race: string;
  veteran: string;
  disability: string;
  salaryExpectation: string;
  earliestStart: string;
  willingToRelocate: "yes" | "no" | "";
}

/** Free-form text documents stored by id. "masterProfile": everything she has done, the only
 * source of truth the resume tailoring engine may draw from (lib/resume/engine). */
export interface TextDoc {
  id: "masterProfile";
  text: string;
  updatedAt: number;
}

export interface ScoreWeights {
  sponsorship: number;
  location: number;
  match: number;
  other: number;
  freshness: number;
}

/**
 * The candidate's must-have filters for a job. Each one that's on and fails means "don't apply".
 * What "fails" means comes from her own Profile and Preferences (lib/eligibility), not from a
 * fixed persona.
 */
export interface MustHaves {
  /** The years / seniority it asks for suit Preferences.experienceLevel. */
  experience: boolean;
  /** Her degree (Profile.degreeType) meets the degree it requires. */
  degree: boolean;
  /** In one of Preferences.locations, with a work style she accepts (Preferences.workModes). */
  location: boolean;
  /** Works with her work authorization (Profile: sponsorship answer, visa status). */
  workAuth: boolean;
  /** No security clearance required. */
  clearance: boolean;
}

/** The must-haves as stored before database v4 (one persona: new grad, bachelor's, on OPT). */
export interface LegacyMustHaves {
  newGrad?: boolean;
  bachelorsEnough?: boolean;
  location?: boolean;
  internationalOk?: boolean;
  opt?: boolean;
}

export interface Preferences {
  id: "me";
  targetRoles: string[];
  keywords: string[];
  seniority: string[]; // e.g. "new grad", "entry level"
  experienceLevel: ExperienceLevel;
  /** Kinds of job to accept. Remote here and "remote-us" in `locations` are kept in sync. */
  workModes: WorkMode[];
  /**
   * Where she'd work, as ids (lib/geo/choices.ts): "remote-us", "us", "state:CA", "metro:la",
   * "city:boise-id". Hybrid and on-site jobs must be in one of the places.
   */
  locations: string[];
  /** @deprecated Region names from before database v4. Migrated to `locations`; only old records have it. */
  regions?: string[];
  /** Companies the job feed searches (lib/discovery). Editable — not a permanent list. */
  companyWatchlist: string[];
  mustHaves: MustHaves;
  dealBreakers: {
    noSponsorship: boolean;
    citizenshipRequired: boolean;
    clearanceRequired: boolean;
    locationOutsideTargets: boolean;
  };
  weights: ScoreWeights;
  applyThreshold: number; // score at or above this means "Apply"
}

export interface AnswerBankEntry {
  id?: number;
  question: string;
  answer: string;
  tags: string[];
}

export interface BaseResume {
  id?: number;
  label: string; // job type, e.g. "SWE", "AI/ML"
  fileName: string;
  format: "docx" | "pdf";
  bytes: ArrayBuffer;
  /** JSON-stringified ResumeStructure (lib/docx/types.ts). Parsing a .docx is free and redone on
   * demand, but a .pdf's structure comes from an AI call, so it's cached here after import. */
  structure?: string;
  addedAt: number;
}

// Dates are "YYYY-MM-DD" strings ("" when unset) so time zones never shift them.
export interface Application {
  id?: number;
  // Fields from the user's Notion tracker
  company: string;
  stage: Stage;
  role: string; // "Job position"
  url: string; // "Job position link"
  location: string;
  workMode: WorkMode | "Unknown";
  appliedDate: string;
  respondDate: string;
  referral: string;
  tailoredUrl: string;
  contactName: string; // "Name of the person to reach out to"
  contactLinkedin: string;
  // Added fields
  roleType: RoleType;
  salary: string;
  source: string;
  visa: VisaSignal;
  followUpDate: string;
  notes: string;
  jdText: string;
  /**
   * Where the job sits before she commits to it. Absent: it's in her applications table.
   * "checked": analyzed, kept in "Checked jobs" until she adds it, tailors for it or applies.
   * "skipped": she chose "Not applying"; remembered (so a repeat check is recognized) but hidden.
   */
  triage?: "checked" | "skipped";
  fitScore?: number;
  /** JSON-stringified ScoreResult (see lib/scoring/score.ts), for showing the breakdown again later. */
  fitBreakdown?: string;
  baseResumeId?: number;
  tailoredResumeId?: number;
  /** JSON-stringified TailorDraft (lib/resume/batch.ts): an AI proposal prepared ahead of time
   * (by the feed's batch tailoring), not yet reviewed. Nothing from it is in a resume file until
   * she accepts it in the Tailor dialog. */
  tailorDraft?: string;
  createdAt: number;
  updatedAt: number;
}

export interface FeedItem {
  id?: number;
  source: string;
  externalId: string;
  url: string;
  company: string;
  title: string;
  location: string;
  workMode: WorkMode | "Unknown";
  visa: VisaSignal;
  jdText: string;
  firstSeen: number;
  fitScore?: number;
  /** JSON-stringified ScoreResult (see lib/scoring/score.ts). */
  fitBreakdown?: string;
  /** JSON-stringified TailorDraft — see Application.tailorDraft. Carried over on Start application. */
  tailorDraft?: string;
  state: "new" | "saved" | "dismissed" | "started";
}

export interface TailoredResume {
  id?: number;
  applicationId: number;
  /** Set for resumes tailored from a base resume file (the older flow); absent for ones generated
   * from the master profile (lib/resume/engine). */
  baseResumeId?: number;
  format: "docx" | "pdf";
  bytes: ArrayBuffer;
  savedPath?: string;
  /** Share of the job's skills in the master profile (before) and on the tailored page (after),
   * 0-100 (lib/resume/coverage.ts). Older rows used raw keyword overlap. */
  keywordScoreBefore: number;
  keywordScoreAfter: number;
  /** JSON-stringified { bulletEdits, skillReorders, appliedSkills } — what she accepted, so
   * reopening the application can show the diff again without re-tailoring. */
  appliedEdits: string;
  createdAt: number;
}

export interface Contact {
  id?: number;
  applicationId: number;
  name: string;
  role: string;
  linkedinUrl: string;
  type: "recruiter" | "hiring-manager" | "alumni" | "engineer" | "other";
  status: "to-contact" | "sent" | "replied";
  draft: string;
}
