import type { Application } from "../types";

// "15 applications this week": an optional goal she sets in Job preferences. A week runs Monday to
// Sunday in her own time zone. An application counts in the week of its applied date, which the
// tracker fills in when a job moves to Applied (lib/tracker/stage.ts).

const pad = (n: number) => String(n).padStart(2, "0");
const isoDay = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** This week's Monday and Sunday as local "YYYY-MM-DD". */
export function weekBounds(now: Date): { start: string; end: string } {
  const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - ((now.getDay() + 6) % 7));
  const sunday = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 6);
  return { start: isoDay(monday), end: isoDay(sunday) };
}

/** Jobs she applied to this week (by applied date), skipped jobs left out. */
export function appliedThisWeek(apps: Pick<Application, "appliedDate" | "stage" | "triage">[], now: Date): number {
  const { start, end } = weekBounds(now);
  return apps.filter((a) => a.stage !== "Saved" && a.triage !== "skipped" && !!a.appliedDate && a.appliedDate >= start && a.appliedDate <= end).length;
}

/** A usable goal from the stored value, or null when it's off. */
export function goalOf(value: number | undefined): number | null {
  return value && Number.isFinite(value) && value > 0 ? Math.round(value) : null;
}
