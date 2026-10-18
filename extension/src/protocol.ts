// The messages the Job Copilot app and this extension exchange. Point-to-point only: the app calls
// chrome.runtime.sendMessage / chrome.runtime.connect with this extension's ID, which Chrome allows
// only from the origins listed under "externally_connectable" in manifest.json. Nothing goes
// through window.postMessage, where any other script or extension on the page could read it.
//
// The app keeps its own copy of these shapes (lib/extension/protocol.ts); bump PROTOCOL_VERSION in
// both when one changes. No API key is ever part of any message: the extension never holds one.

import type { SyncedData } from "./types";

export const PROTOCOL_VERSION = 1;

/** The app origins allowed to talk to the extension. Must match manifest.json externally_connectable. */
export const APP_ORIGINS = ["https://job-copilot-arina-ovcharenkos-projects.vercel.app", "http://localhost:3000"] as const;
export const DEFAULT_APP_ORIGIN: string = APP_ORIGINS[0];

/** chrome.runtime.connect name the app uses for its long-lived connection. */
export const PORT_NAME = "job-copilot-app";

export function isAppOrigin(origin: string | undefined): origin is (typeof APP_ORIGINS)[number] {
  return !!origin && (APP_ORIGINS as readonly string[]).includes(origin);
}

// ---- One-shot messages from the app (chrome.runtime.sendMessage(EXTENSION_ID, message)) ----

export type ExternalMessage =
  | { type: "PING"; token?: string }
  | { type: "PAIR_START" }
  | { type: "PAIR_STATUS" }
  | { type: "UNPAIR"; token: string };

export interface PingReply {
  ok: true;
  version: string;
  protocol: number;
  /** True when `token` is the pairing token this origin was given. */
  paired: boolean;
}
export type PairStartReply = { ok: true; code: string } | { ok: false; error: string };
export type PairStatusReply = { status: "pending" | "denied" | "expired" | "none" } | { status: "approved"; token: string };

// ---- The long-lived connection (chrome.runtime.connect(EXTENSION_ID, { name: PORT_NAME })) ----

/** What the app sends to the extension over the port. */
export type AppToExt =
  | { kind: "hello"; token: string; protocol: number }
  | { kind: "push"; method: "sync"; params: SyncedData }
  | { kind: "push"; method: "draftResult"; params: DraftResult }
  | { kind: "push"; method: "draftCancelled"; params: { requestId: string } }
  | { kind: "res"; id: string; result?: unknown; error?: string };

/** What the extension sends to the app over the port. */
export type ExtToApp =
  | { kind: "welcome" }
  | { kind: "rejected"; reason: string }
  | { kind: "req"; id: string; method: RequestMethod; params: unknown };

/** Requests the extension can make of the app, with their params and results. */
export interface Requests {
  /** The app answers with a fresh copy of the synced data. */
  sync: { params: Record<string, never>; result: SyncedData };
  /** The job's tailored resume as a .docx rendered by the app, else the newest base resume. */
  getResume: { params: { jobId: number | null }; result: ResumeFile | null };
  /** She filled a question herself and chose "Save to answer bank". */
  saveAnswer: { params: { question: string; answer: string }; result: { saved: boolean; duplicate: boolean } };
  /** After SHE submitted: set the applied date (and the follow-up reminder) in the tracker. */
  markApplied: { params: MarkAppliedParams; result: { jobId: number; appliedDate: string; followUpDate: string; created: boolean } };
  /** Shows a draft request in the app. The answer comes back later as a "draftResult" push, only
   * after she approved it there. */
  draftRequest: { params: DraftRequest; result: { shown: boolean } };
  /** "Score this job": the app opens Add job with the page's text. */
  capturedJob: { params: { text: string; url: string }; result: { ok: boolean } };
}
export type RequestMethod = keyof Requests;

export interface ResumeFile {
  fileName: string;
  /** Base64 .docx (or .pdf for a PDF base resume) bytes. */
  base64: string;
  mimeType: string;
  source: "tailored" | "base";
  /** Shown to her, e.g. why a base resume was used instead of a tailored one. */
  note?: string;
}

export interface MarkAppliedParams {
  jobId: number | null;
  url: string;
  company: string;
  role: string;
  /** Seconds from her first "Fill" click to the confirmation page. */
  fillSeconds?: number;
}

export interface DraftRequest {
  requestId: string;
  question: string;
  /** The page's visible text, for context on the role (capped). */
  jobText: string;
  pageUrl: string;
  jobId: number | null;
}

export interface DraftResult {
  requestId: string;
  answer: string;
}
