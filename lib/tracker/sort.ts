import { CLOSED_STAGES, type Application } from "../types";

type Sortable = Pick<Application, "stage" | "appliedDate" | "createdAt">;

/**
 * Tracker table order: Saved jobs (not applied yet) first, newest added on top, so a job she
 * just added doesn't sink below everything with an apply date. Then everything else by apply
 * date, newest first, and by when it was added for ties or missing dates. Closed jobs (rejected,
 * no response, withdrawn) always go to the bottom, in the same order among themselves. Returns a new array.
 */
export function sortApplications<T extends Sortable>(apps: readonly T[]): T[] {
  return [...apps].sort((a, b) => {
    const aRejected = CLOSED_STAGES.has(a.stage);
    const bRejected = CLOSED_STAGES.has(b.stage);
    if (aRejected !== bRejected) return aRejected ? 1 : -1;
    const aSaved = a.stage === "Saved";
    const bSaved = b.stage === "Saved";
    if (aSaved !== bSaved) return aSaved ? -1 : 1;
    if (aSaved) return (b.createdAt ?? 0) - (a.createdAt ?? 0);
    return (b.appliedDate || "").localeCompare(a.appliedDate || "") || (b.createdAt ?? 0) - (a.createdAt ?? 0);
  });
}
