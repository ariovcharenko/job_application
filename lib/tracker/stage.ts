import type { Application, Stage } from "../types";

/** Today as a local "YYYY-MM-DD" string. */
export function todayISO(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** Days after applying before the tracker reminds her to follow up. */
export const FOLLOW_UP_DAYS = 7;

/** A "YYYY-MM-DD" date moved by whole days (calendar math in UTC, so no DST drift). */
export function addDays(date: string, days: number): string {
  const t = Date.parse(`${date}T00:00:00Z`);
  if (Number.isNaN(t)) return "";
  return new Date(t + days * 86_400_000).toISOString().slice(0, 10);
}

/**
 * Move an application to a new stage and fill the matching date if it is empty:
 * Applied sets the apply date and a follow-up reminder a week later, and any reply stage sets
 * the respond date. Existing dates are never overwritten.
 */
export function applyStageChange(app: Application, stage: Stage, today: string = todayISO()): Application {
  const next: Application = { ...app, stage };
  // Applying (or hearing back) means it's a real application now: it joins the table.
  if (stage !== "Saved") delete next.triage;
  if (stage === "Applied") {
    if (!next.appliedDate) next.appliedDate = today;
    if (!next.followUpDate) next.followUpDate = addDays(next.appliedDate, FOLLOW_UP_DAYS) || addDays(today, FOLLOW_UP_DAYS);
  }
  if ((stage === "Waiting for interview" || stage === "Offer" || stage === "Rejected") && !next.respondDate) {
    next.respondDate = today;
    if (!next.appliedDate) next.appliedDate = today;
  }
  return next;
}

/** Whole days between two "YYYY-MM-DD" dates, or null if either is missing/invalid. */
export function daysBetween(from: string, to: string): number | null {
  if (!from || !to) return null;
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return Math.round((b - a) / 86_400_000);
}

/** An applied job with no reply and a follow-up date that has arrived. */
export function needsFollowUp(app: Application, today: string = todayISO()): boolean {
  return app.stage === "Applied" && !app.respondDate && !!app.followUpDate && app.followUpDate <= today;
}

/** "Done" on a due follow-up: she followed up, so the reminder goes away. */
export function completeFollowUp(app: Application): Application {
  return { ...app, followUpDate: "" };
}

/** "Snooze a week" on a due follow-up: remind her again seven days from today. */
export function snoozeFollowUp(app: Application, today: string = todayISO()): Application {
  return { ...app, followUpDate: addDays(today, FOLLOW_UP_DAYS) };
}
