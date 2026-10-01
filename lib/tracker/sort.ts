import type { Application } from "../types";

type Sortable = Pick<Application, "stage" | "appliedDate" | "createdAt">;

/**
 * Tracker table order: Saved jobs (not applied yet) first, newest added on top, so a job she
 * just added doesn't sink below everything with an apply date. Then everything else by apply
 * date, newest first, and by when it was added for ties or missing dates. Returns a new array.
 */
export function sortApplications<T extends Sortable>(apps: readonly T[]): T[] {
  return [...apps].sort((a, b) => {
    const aSaved = a.stage === "Saved";
    const bSaved = b.stage === "Saved";
    if (aSaved !== bSaved) return aSaved ? -1 : 1;
    if (aSaved) return (b.createdAt ?? 0) - (a.createdAt ?? 0);
    return (b.appliedDate || "").localeCompare(a.appliedDate || "") || (b.createdAt ?? 0) - (a.createdAt ?? 0);
  });
}
