import { callJev, choice, noul, type JevOptions, type JevQuestion, type JevResult } from "../ai/jev";
import type { CandidateFacts } from "../eligibility/candidate";
import type { MustHaves } from "../types";

// The "early read": a fast, optional first look at a posting from Jev (lib/ai/jev.ts), shown
// while Claude's full check runs. It is a hint only:
//  - Claude's extracted facts plus code (lib/intake/analyze.ts) always produce the stored verdict
//    and match percentage (decision #7). Nothing here is stored except the interview focus.
//  - It is never used for a legal answer (decision #4), and never silently skips a job: it can
//    only offer a skip that she must click.
// With no Jev key, or on any Jev error, this returns null and the flow is exactly as without it.

/**
 * Jev's noul answer is the probability of "yes" and has no separate confidence (docs: noul
 * primitive). The docs' own example turns it into a yes with `noul > 0.9`, and say to raise the
 * bar when a false yes is expensive. A false skip offer costs her a click, but an early "not a
 * fit" is the most consequential thing this feature says, so it uses that documented 0.9.
 */
export const SKIP_NOUL_MIN = 0.9;

/**
 * Choice answers carry `confidence` (0 to 1). The docs (confidence page) give no universal cutoff:
 * below 0.5 their example calls the model "genuinely unsure", above 0.9 is their bar for a
 * high-stakes action. The interview chip is low stakes and read-only, but Jev's Choice has a
 * documented first-option bias, so 0.7 sits well clear of "unsure" without demanding 0.9.
 */
export const CHOICE_CONFIDENCE_MIN = 0.7;

export const INTERVIEW_FOCUS = ["coding", "system_design", "behavioral", "mixed"] as const;
export type InterviewFocus = (typeof INTERVIEW_FOCUS)[number];
export const INTERVIEW_LABEL: Record<InterviewFocus, string> = { coding: "coding", system_design: "system design", behavioral: "behavioral", mixed: "a mix of coding, design and behavioral" };
type WorkStyle = "remote" | "hybrid" | "onsite";

/** Longest text sent: Jev is documented to do worse with long, unfocused text. */
export const EARLY_READ_MAX_CHARS = 5000;

const RELEVANT =
  /visa|sponsor|work authori[sz]|authori[sz]ed to work|eligib|citizen|clearance|green card|\bOPT\b|\bCPT\b|immigration|remote|hybrid|on-?site|in[- ]office|days (a|per) week|interview|coding|algorithm|system design|whiteboard|assessment|screen/i;

/**
 * Trims a posting to what the early questions need: whitespace collapsed, and if it is long, its
 * opening plus the paragraphs that mention visas, work style or interviews, up to the cap.
 */
export function trimForEarlyRead(jdText: string, max = EARLY_READ_MAX_CHARS): string {
  const text = jdText.replace(/\r/g, "").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  if (text.length <= max) return text;
  const head = text.slice(0, Math.floor(max * 0.4));
  const rest = text.slice(head.length).split(/\n+/);
  const picked: string[] = [];
  let used = head.length;
  for (const para of rest) {
    const p = para.trim();
    if (!p || !RELEVANT.test(p)) continue;
    const piece = p.length > 700 ? p.slice(0, 700) : p;
    if (used + piece.length + 1 > max) break;
    picked.push(piece);
    used += piece.length + 1;
  }
  return [head, ...picked].join("\n");
}

export const EARLY_QUESTIONS: Record<string, JevQuestion> = {
  noSponsor: noul("The posting says the company will not sponsor work visas"),
  noOpt: noul("The posting says candidates on OPT or needing future sponsorship are not eligible"),
  citizenOrClearance: noul("The posting requires U.S. citizenship or an active security clearance"),
  // "not_stated" first: Choice leans to its first option, so doubt falls back to "not stated".
  workStyle: choice("How does the posting say the work is done?", {
    not_stated: "The posting does not say where the work is done",
    remote: "The job is fully remote",
    hybrid: "Some days in an office and some days remote",
    onsite: "The job is done on site, in an office",
  }),
  interviewFocus: choice("What will the interview mainly test, according to the posting?", {
    not_stated: "The posting does not describe the interview",
    coding: "Writing code or solving algorithm problems",
    system_design: "Designing systems or architecture",
    behavioral: "Past experience and behavioral questions",
    mixed: "Several of these in about equal parts",
  }),
};

export interface EarlyRead {
  /** Probabilities of yes, 0 to 1. */
  noSponsor: number;
  noOpt: number;
  citizenOrClearance: number;
  workStyle: { value: WorkStyle; confidence: number } | null;
  interviewFocus: { value: InterviewFocus; confidence: number } | null;
}

/** Turns a Jev result into an EarlyRead. Missing or malformed answers count as 0 (no signal). Exported for tests. */
export function toEarlyRead(r: JevResult): EarlyRead {
  const n = (id: string) => {
    const a = r.answers[id];
    return a?.type === "noul" && a.noul >= 0 && a.noul <= 1 ? a.noul : 0;
  };
  const c = <T extends string>(id: string, allowed: readonly T[]): { value: T; confidence: number } | null => {
    const a = r.answers[id];
    if (a?.type !== "choice") return null;
    return (allowed as readonly string[]).includes(a.choice) ? { value: a.choice as T, confidence: a.confidence } : null;
  };
  return {
    noSponsor: n("noSponsor"),
    noOpt: n("noOpt"),
    citizenOrClearance: n("citizenOrClearance"),
    workStyle: c<WorkStyle>("workStyle", ["remote", "hybrid", "onsite"]),
    interviewFocus: c<InterviewFocus>("interviewFocus", INTERVIEW_FOCUS),
  };
}

/** One batched Jev request. Returns null (never throws) with no key, no text, or on any Jev error. */
export async function runEarlyRead(jevKey: string | undefined, jdText: string, opts: JevOptions = {}): Promise<EarlyRead | null> {
  if (!jevKey?.trim() || !jdText.trim()) return null;
  try {
    return toEarlyRead(await callJev(jevKey, trimForEarlyRead(jdText), EARLY_QUESTIONS, opts));
  } catch {
    return null;
  }
}

export interface SkipOffer {
  /** Short reason in plain words, for the prompt and the saved note. */
  reason: string;
}

/**
 * Whether to offer to skip the full check. Only for a must-have she has turned on, that applies
 * to her (a no-sponsorship posting is no problem for someone who doesn't need sponsorship, as in
 * lib/scoring/criteria.ts), and only when Jev is at least SKIP_NOUL_MIN sure. It is an offer:
 * nothing is skipped without her click.
 */
export function skipOffer(read: EarlyRead, mustHaves: MustHaves, candidate: CandidateFacts): SkipOffer | null {
  if (mustHaves.workAuth) {
    if (read.noSponsor >= SKIP_NOUL_MIN && candidate.needsSponsorship) return { reason: "won't sponsor" };
    if (read.noOpt >= SKIP_NOUL_MIN && candidate.onStudentVisa) return { reason: "excludes OPT or future sponsorship" };
  }
  if (read.citizenOrClearance >= SKIP_NOUL_MIN) {
    if (mustHaves.clearance) return { reason: "needs citizenship or a security clearance" };
    if (mustHaves.workAuth && candidate.visaStatusSet && !candidate.isCitizen) return { reason: "needs U.S. citizenship" };
  }
  return null;
}

/** The interview focus to remember, or null when Jev wasn't sure enough or the posting doesn't say. */
export function interviewFocusOf(read: EarlyRead | null): InterviewFocus | null {
  const f = read?.interviewFocus;
  return f && f.confidence >= CHOICE_CONFIDENCE_MIN ? f.value : null;
}

export interface EarlyPill {
  label: string;
  /** "flag": Jev is sure it found a problem. "quiet": nothing found yet (not a pass: absence is weak evidence). */
  tone: "flag" | "quiet";
}

/** Muted pills for the must-haves she has on, while Claude's check runs. Never a green check. */
export function earlyPills(read: EarlyRead, mustHaves: MustHaves): EarlyPill[] {
  const pills: EarlyPill[] = [];
  if (mustHaves.workAuth) {
    const flags = [read.noSponsor >= SKIP_NOUL_MIN && "won't sponsor", read.noOpt >= SKIP_NOUL_MIN && "excludes OPT", read.citizenOrClearance >= SKIP_NOUL_MIN && "citizenship"].filter(Boolean);
    pills.push(flags.length ? { label: `Work auth: ${flags.join(", ")}`, tone: "flag" } : { label: "Work auth: nothing found yet", tone: "quiet" });
  }
  if (mustHaves.clearance) {
    pills.push(read.citizenOrClearance >= SKIP_NOUL_MIN ? { label: "Clearance: may be required", tone: "flag" } : { label: "Clearance: nothing found yet", tone: "quiet" });
  }
  if (mustHaves.location && read.workStyle && read.workStyle.confidence >= CHOICE_CONFIDENCE_MIN) {
    pills.push({ label: `Work style: ${read.workStyle.value === "onsite" ? "on site" : read.workStyle.value}`, tone: "quiet" });
  }
  return pills;
}
