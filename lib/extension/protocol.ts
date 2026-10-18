// The app's copy of the messages it exchanges with the Chrome extension (the extension's own copy
// is extension/src/protocol.ts + extension/src/types.ts). Bump PROTOCOL_VERSION in both when a
// shape changes; lib/extension/protocol.test.ts compares the two files.
//
// Point-to-point only: chrome.runtime.sendMessage / connect with the extension's ID, which Chrome
// accepts only from the origins in the extension manifest's "externally_connectable". Nothing goes
// through window.postMessage. No API key is ever part of any message.

export const PROTOCOL_VERSION = 1;
export const PORT_NAME = "job-copilot-app";

/** The extension's ID, derived from the fixed "key" in extension/manifest.json (so it is the same
 * on every machine that loads the unpacked folder). She can paste a different one in Settings. */
export const DEFAULT_EXTENSION_ID = "gnpdjlpeljngidmbgdclgdiodghkckdn";

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

export interface SyncedExperience {
  title: string;
  company: string;
  location: string;
  dates: string;
  section: string;
  bullets: string[];
}

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
  masterProfile: string;
  experiences: SyncedExperience[];
  jobs: SyncedJob[];
  updatedAt: number;
}

export type ExternalMessage = { type: "PING"; token?: string } | { type: "PAIR_START" } | { type: "PAIR_STATUS" } | { type: "UNPAIR"; token: string };

export interface PingReply {
  ok: true;
  version: string;
  protocol: number;
  paired: boolean;
}
export type PairStartReply = { ok: true; code: string } | { ok: false; error: string };
export type PairStatusReply = { status: "pending" | "denied" | "expired" | "none" } | { status: "approved"; token: string };

export interface ResumeFile {
  fileName: string;
  base64: string;
  mimeType: string;
  source: "tailored" | "base";
  note?: string;
}

export interface MarkAppliedParams {
  jobId: number | null;
  url: string;
  company: string;
  role: string;
  fillSeconds?: number;
}

export interface DraftRequest {
  requestId: string;
  question: string;
  jobText: string;
  pageUrl: string;
  jobId: number | null;
}

export interface DraftResult {
  requestId: string;
  answer: string;
}

export interface Requests {
  sync: { params: Record<string, never>; result: SyncedData };
  getResume: { params: { jobId: number | null }; result: ResumeFile | null };
  saveAnswer: { params: { question: string; answer: string }; result: { saved: boolean; duplicate: boolean } };
  markApplied: { params: MarkAppliedParams; result: { jobId: number; appliedDate: string; followUpDate: string; created: boolean } };
  draftRequest: { params: DraftRequest; result: { shown: boolean } };
  capturedJob: { params: { text: string; url: string }; result: { ok: boolean } };
}
export type RequestMethod = keyof Requests;

export type AppToExt =
  | { kind: "hello"; token: string; protocol: number }
  | { kind: "push"; method: "sync"; params: SyncedData }
  | { kind: "push"; method: "draftResult"; params: DraftResult }
  | { kind: "push"; method: "draftCancelled"; params: { requestId: string } }
  | { kind: "res"; id: string; result?: unknown; error?: string };

export type ExtToApp =
  | { kind: "welcome" }
  | { kind: "rejected"; reason: string }
  | { kind: "req"; id: string; method: RequestMethod; params: unknown };
