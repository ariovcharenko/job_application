import { db } from "../db";
import { findMatch } from "../intake/dedupe";
import { blankApplication } from "../tracker/blank";
import { applyStageChange, todayISO } from "../tracker/stage";
import type { Application } from "../types";
import type { MarkAppliedParams, Requests } from "./protocol";

/**
 * "Mark as applied in Job Copilot", clicked in the extension on a confirmation page after SHE
 * submitted. Moves the job to Applied (apply date today, follow-up reminder a week later, like the
 * stage menu does), keeps the time the form took, and never touches a job that is already past
 * Saved. A page that isn't one of her saved jobs becomes a new row, so the follow-up still starts.
 */
export async function markAppliedFromExtension(p: MarkAppliedParams, today: string = todayISO()): Promise<Requests["markApplied"]["result"]> {
  const apps = (await db.applications.toArray()) as (Application & { id: number })[];
  const byId = p.jobId !== null ? apps.find((a) => a.id === p.jobId) : undefined;
  const found = byId ?? findMatch(apps, { url: p.url, company: p.company, role: p.role });

  if (!found) {
    if (!p.company.trim() && !p.role.trim() && !p.url.trim()) throw new Error("The page didn't say which job this was, so nothing was added.");
    const next = applyStageChange({ ...blankApplication(), company: p.company.trim() || "Unknown company", role: p.role.trim(), url: p.url, source: "Chrome extension" }, "Applied", today);
    if (p.fillSeconds !== undefined) next.fillSeconds = p.fillSeconds;
    const id = (await db.applications.add({ ...next, createdAt: Date.now(), updatedAt: Date.now() })) as number;
    return { jobId: id, appliedDate: next.appliedDate, followUpDate: next.followUpDate, created: true };
  }

  // Already applied (or further along, or closed): leave it exactly as it is.
  if (found.stage !== "Saved") return { jobId: found.id, appliedDate: found.appliedDate, followUpDate: found.followUpDate, created: false };

  const next = applyStageChange(found, "Applied", today);
  const patch: Partial<Application> = { stage: next.stage, appliedDate: next.appliedDate, followUpDate: next.followUpDate, triage: undefined, updatedAt: Date.now() };
  if (p.fillSeconds !== undefined) patch.fillSeconds = p.fillSeconds;
  await db.applications.update(found.id, patch);
  return { jobId: found.id, appliedDate: next.appliedDate, followUpDate: next.followUpDate, created: false };
}
