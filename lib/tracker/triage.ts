import type { Application } from "../types";

// A job she has only checked isn't an application yet. It lives in "Checked jobs" until she adds
// it, tailors a resume for it or applies (then it joins the table), or says "Not applying"
// (then it stays remembered but hidden). Rows without a triage field are in the table, so every
// job from before this existed keeps showing there.

export const isTracked = (a: Pick<Application, "triage">) => !a.triage;
export const isSkipped = (a: Pick<Application, "triage">) => a.triage === "skipped";

/** "Add to my applications" (or tailoring/applying): the job joins the table. */
export function trackJob<T extends Application>(a: T): T {
  const next = { ...a };
  delete next.triage;
  return next;
}

/** "Not applying": hidden from the table, stats and Up next, but remembered. */
export function skipJob<T extends Application>(a: T): T {
  return { ...a, triage: "skipped" };
}
