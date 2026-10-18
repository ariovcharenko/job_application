// Messages inside the extension: content script / popup / pairing window -> background.
// (The app <-> extension messages are in protocol.ts.)

import type { ResumeFile } from "./protocol";
import type { SyncedData } from "./types";
import type { JobMatch, PageJobInfo } from "./lib/jobMatch";

export type InternalMessage =
  | { type: "GET_CONTEXT"; url: string; page: PageJobInfo }
  | { type: "CAPTURE_JOB"; text: string; url: string }
  | { type: "DRAFT_REQUEST"; question: string; jobText: string; pageUrl: string; jobId: number | null; fieldKey: string }
  | { type: "GET_RESUME"; jobId: number | null }
  | { type: "SAVE_ANSWER"; question: string; answer: string }
  | { type: "FILL_STARTED"; jobId: number | null; url: string; company: string; role: string }
  | { type: "GET_FILL_SESSION" }
  | { type: "CONFIRMATION_SEEN" }
  | { type: "MARK_APPLIED"; url: string; company: string; role: string; jobId: number | null }
  | { type: "END_FILL_SESSION" }
  // Pairing window (extension page only)
  | { type: "GET_PENDING_PAIR" }
  | { type: "PAIR_DECISION"; code: string; allow: boolean }
  // Popup (extension page only)
  | { type: "POPUP_STATUS" }
  | { type: "SITE_ENABLED"; pattern: string; tabId?: number }
  | { type: "SITE_DISABLED"; pattern: string }
  | { type: "SET_APP_ORIGIN"; origin: string }
  | { type: "UNPAIR_ORIGIN"; origin: string };

export interface ContextReply {
  data: SyncedData;
  paired: boolean;
  connected: boolean;
  match: JobMatch | null;
}

export type ResumeReply = { ok: true; resume: ResumeFile | null } | { ok: false; error: string };

export type SimpleReply = { ok: true; queued?: boolean; duplicate?: boolean; detail?: string } | { ok: false; error: string };

export interface FillSession {
  jobId: number | null;
  url: string;
  company: string;
  role: string;
  startedAt: number;
  /** When the confirmation page first appeared: the fill clock stops here, not at her click. */
  confirmedAt?: number;
}

/** Background -> content script (chrome.tabs.sendMessage). */
export type TabMessage =
  | { type: "DRAFT_READY"; requestId: string; fieldKey: string; answer: string }
  | { type: "DRAFT_CANCELLED"; requestId: string; fieldKey: string };
