// Client for TypeSafe's Jev API. Jev blocks browser calls from this site (CORS), so requests go to
// this app's own pass-through route (app/api/jev/route.ts), which forwards them. The key is the
// user's own, kept in this browser and sent with each request. It is never read from anywhere
// else and there is no fallback key.
//
// Jev is used only as a fast, optional early read (lib/intake/earlyRead.ts). Its answers never
// change a stored verdict or match percentage, and are never used for legal answers.

export type JevErrorKind = "no_key" | "auth" | "rate_limit" | "overloaded" | "bad_request" | "too_long" | "network" | "timeout" | "unknown" | "cancelled";

export class JevError extends Error {
  constructor(
    public kind: JevErrorKind,
    message: string,
    public retryAfterMs?: number,
  ) {
    super(message);
    this.name = "JevError";
  }
}

export type JevQuestion =
  | { type: "choice"; instructions: string; criteria: Record<string, string> }
  | { type: "score"; instructions: string; criteria: string[] }
  | { type: "noul"; instructions: string };

export const choice = (instructions: string, options: Record<string, string>): JevQuestion => ({ type: "choice", instructions, criteria: options });
export const score = (instructions: string, levels: string[]): JevQuestion => ({ type: "score", instructions, criteria: levels });
export const noul = (instructions: string): JevQuestion => ({ type: "noul", instructions });

export interface NoulAnswer {
  type: "noul";
  /** Probability the answer is yes, 0 to 1. Noul answers carry no separate confidence. */
  noul: number;
}
export interface ChoiceAnswer {
  type: "choice";
  choice: string;
  confidence: number;
  probabilities: Record<string, number>;
}
export interface ScoreAnswer {
  type: "score";
  score: number;
  confidence: number;
  probabilities: Record<string, number>;
  legend?: Record<string, string>;
}
export type JevAnswer = NoulAnswer | ChoiceAnswer | ScoreAnswer;

export interface JevResult {
  model: string;
  answers: Record<string, JevAnswer>;
  usage?: { input_tokens: number; output_tokens: number };
}

export interface JevOptions {
  signal?: AbortSignal;
  /** For tests. */
  fetch?: typeof fetch;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  now?: () => number;
}

export const JEV_ENDPOINT = "/api/jev";
/** At most one request per this many ms per tab; extra calls wait their turn. */
export const MIN_GAP_MS = 2000;
const MAX_RETRY_WAIT_MS = 3000;

const KINDS: JevErrorKind[] = ["no_key", "auth", "rate_limit", "overloaded", "bad_request", "too_long", "network", "timeout", "unknown"];

function realSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new JevError("cancelled", "Cancelled."));
    const t = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(t);
      reject(new JevError("cancelled", "Cancelled."));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

let nextSlot = 0;
/** Test helper: forget the throttle. */
export function resetJevThrottle(): void {
  nextSlot = 0;
}

async function waitTurn(o: Required<Pick<JevOptions, "sleep" | "now">> & { signal?: AbortSignal }): Promise<void> {
  const now = o.now();
  const slot = Math.max(now, nextSlot);
  nextSlot = slot + MIN_GAP_MS;
  if (slot > now) await o.sleep(slot - now, o.signal);
}

async function once(key: string, state: string | object, questions: Record<string, JevQuestion>, o: JevOptions): Promise<JevResult> {
  const f = o.fetch ?? fetch;
  let res: Response;
  try {
    res = await f(JEV_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key, state, questions }),
      signal: o.signal,
      cache: "no-store",
    });
  } catch (e) {
    if (o.signal?.aborted || (e instanceof Error && e.name === "AbortError")) throw new JevError("cancelled", "Cancelled.");
    throw new JevError("network", "Could not reach the app's server.");
  }
  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    /* handled below */
  }
  if (!res.ok) {
    const err = (data as { error?: { kind?: string; message?: string; retryAfterMs?: number } } | null)?.error;
    const kind = KINDS.includes(err?.kind as JevErrorKind) ? (err!.kind as JevErrorKind) : "unknown";
    throw new JevError(kind, err?.message || "Jev returned an error.", typeof err?.retryAfterMs === "number" ? err.retryAfterMs : undefined);
  }
  return parseJevResult(data);
}

/** Checks the shape of a Jev answer and keeps only well-formed answers. Exported for tests. */
export function parseJevResult(data: unknown): JevResult {
  const d = data as { model?: unknown; answers?: unknown; usage?: JevResult["usage"] } | null;
  if (!d || typeof d !== "object" || !d.answers || typeof d.answers !== "object") throw new JevError("unknown", "Jev sent an unreadable answer.");
  const answers: Record<string, JevAnswer> = {};
  for (const [id, a] of Object.entries(d.answers as Record<string, Record<string, unknown>>)) {
    if (!a || typeof a !== "object") continue;
    if (a.type === "noul" && typeof a.noul === "number") answers[id] = { type: "noul", noul: a.noul };
    else if (a.type === "choice" && typeof a.choice === "string")
      answers[id] = { type: "choice", choice: a.choice, confidence: typeof a.confidence === "number" ? a.confidence : 0, probabilities: (a.probabilities as Record<string, number>) ?? {} };
    else if (a.type === "score" && typeof a.score === "number")
      answers[id] = {
        type: "score",
        score: a.score,
        confidence: typeof a.confidence === "number" ? a.confidence : 0,
        probabilities: (a.probabilities as Record<string, number>) ?? {},
        legend: a.legend as Record<string, string> | undefined,
      };
  }
  return { model: typeof d.model === "string" ? d.model : "", answers, usage: d.usage };
}

/**
 * Asks Jev the questions about `state`. Waits so a tab sends at most one request per 2 seconds,
 * and retries once on 429/529 after the server's Retry-After (capped at 3 seconds).
 */
export async function callJev(key: string, state: string | object, questions: Record<string, JevQuestion>, opts: JevOptions = {}): Promise<JevResult> {
  if (!key.trim()) throw new JevError("no_key", "No Jev key is saved.");
  const sleep = opts.sleep ?? realSleep;
  const now = opts.now ?? Date.now;
  const t = { sleep, now, signal: opts.signal };
  await waitTurn(t);
  try {
    return await once(key.trim(), state, questions, opts);
  } catch (e) {
    if (e instanceof JevError && (e.kind === "rate_limit" || e.kind === "overloaded")) {
      await sleep(Math.min(e.retryAfterMs ?? 1000, MAX_RETRY_WAIT_MS), opts.signal);
      await waitTurn(t);
      return once(key.trim(), state, questions, opts);
    }
    throw e;
  }
}

/** For Settings: one tiny question. Returns a plain result line. */
export async function testJevConnection(key: string, opts: JevOptions = {}): Promise<{ ok: boolean; message: string }> {
  try {
    const r = await callJev(key, "The sky is blue.", { t: noul("The text says the sky is blue.") }, opts);
    if (r.answers.t?.type !== "noul") return { ok: false, message: "Jev answered, but not in the expected form." };
    return { ok: true, message: "Connected. Your Jev key works." };
  } catch (e) {
    if (e instanceof JevError) {
      if (e.kind === "auth" || e.kind === "no_key") return { ok: false, message: "Jev did not accept this key. Check that you copied the whole key from TypeSafe." };
      if (e.kind === "rate_limit" || e.kind === "overloaded") return { ok: false, message: "Jev is busy or limiting this key right now. Try again in a minute." };
      if (e.kind === "network") return { ok: false, message: "Could not reach Jev. Check your connection." };
      return { ok: false, message: e.message };
    }
    return { ok: false, message: "The test failed." };
  }
}
