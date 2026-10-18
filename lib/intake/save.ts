import { db } from "../db";
import { blankApplication } from "../tracker/blank";
import { normalizeRoleType } from "../tracker/csvMap";
import { saveApplication, saveApplicationChanges } from "../tracker/repo";
import type { Application } from "../types";
import { toStoredBreakdown, type JobAnalysis } from "./analyze";
import { findExistingJob } from "./dedupe";
import { hasIncompletePosting } from "./stored";

export type SavedJob = Application & {
  id: number;
  /** When she had already checked this position (same link, or same company and role). */
  checkedBefore?: number;
};

/**
 * Remembers an analyzed job. A new one goes to "Checked jobs" (not the applications table) until
 * she adds it, tailors for it or applies. The same position checked again (same link, ignoring
 * tracking parameters, or the same company and role) updates that row instead of adding a
 * duplicate, keeping her own edits and where it already is (table, checked or skipped).
 * `updateId` re-checks that specific row (e.g. "Paste and re-check"), even with no or an edited link.
 *
 * On an existing row her own values win: company, position, location, salary, work mode,
 * sponsorship and role type are only filled where they are empty or still the "not set" default.
 * The saved job description is replaced only by a re-check of that row (`updateId`, which is
 * what pasting the full text is for), or when the saved one is empty or just a page shell.
 */
export async function saveAnalyzedJob(a: JobAnalysis, updateId?: number): Promise<SavedJob> {
  const fromJob: Partial<Application> = {
    company: a.signals.company,
    role: a.signals.role,
    url: a.url,
    location: a.signals.location,
    workMode: a.signals.workMode,
    salary: a.signals.salary,
    roleType: normalizeRoleType(a.signals.role),
    visa: a.signals.visaSignal,
    jdText: a.jdText,
    fitScore: a.score.score,
    fitBreakdown: JSON.stringify(toStoredBreakdown(a)),
  };

  const target = updateId !== undefined ? await db.applications.get(updateId) : undefined;
  const existing = target ?? (await findExistingJob({ url: a.url, company: a.signals.company, role: a.signals.role }));
  const app: Application = existing
    ? {
        ...existing,
        ...fromJob,
        // Keep anything she typed herself over what the posting says.
        company: existing.company || fromJob.company!,
        role: existing.role || fromJob.role!,
        location: existing.location || fromJob.location!,
        salary: existing.salary || fromJob.salary!,
        workMode: existing.workMode && existing.workMode !== "Unknown" ? existing.workMode : fromJob.workMode!,
        visa: existing.visa && existing.visa !== "unknown" ? existing.visa : fromJob.visa!,
        roleType: existing.roleType && existing.roleType !== "Other" ? existing.roleType : fromJob.roleType!,
        jdText: target || !existing.jdText?.trim() || hasIncompletePosting(existing) ? fromJob.jdText! : existing.jdText,
        url: a.url || existing.url,
      }
    : { ...blankApplication(), ...fromJob, stage: "Saved", triage: "checked" };
  // Only the fields that change are written (see saveApplicationChanges).
  const id = existing ? await saveApplicationChanges(app, existing) : await saveApplication(app);
  return { ...app, id, ...(existing && !target ? { checkedBefore: existing.updatedAt || existing.createdAt } : {}) };
}
