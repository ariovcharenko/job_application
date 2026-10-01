import { downloadBlob } from "../../download";
import { db, getSettings } from "../../db";
import { ensurePermission, getOrCreateTailoredDir, writeResumeFile } from "../../fsAccess";
import type { Application, TailoredResume } from "../../types";
import { ResumeDocSchema, type ResumeDoc } from "./schema";

export function downloadBytes(bytes: ArrayBuffer, fileName: string) {
  downloadBlob(new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" }), fileName);
}

/**
 * What's kept in TailoredResume.appliedEdits for a master-profile resume, so it can be reopened
 * exactly as she left it: the validated document (before her ticks are applied), the flag
 * messages she ticked, and the final one-page document that went into the .docx.
 */
export interface StoredEngineResume {
  v: 2;
  doc: ResumeDoc;
  approved: string[];
  final: ResumeDoc;
}

/** Reads appliedEdits back. Older rows stored just the final document; those reopen with no ticks. */
export function parseStoredResume(appliedEdits: string): StoredEngineResume | null {
  try {
    const raw = JSON.parse(appliedEdits);
    if (raw?.v === 2) {
      return { v: 2, doc: ResumeDocSchema.parse(raw.doc), approved: Array.isArray(raw.approved) ? raw.approved : [], final: ResumeDocSchema.parse(raw.final) };
    }
    const doc = ResumeDocSchema.safeParse(raw);
    return doc.success ? { v: 2, doc: doc.data, approved: [], final: doc.data } : null;
  } catch {
    return null;
  }
}

/** The master-profile resume saved for this job, if any (older base-resume tailoring is ignored). */
export async function getJobResume(applicationId: number): Promise<(TailoredResume & { id: number; stored: StoredEngineResume }) | null> {
  const rows = await db.tailoredResumes.where("applicationId").equals(applicationId).toArray();
  const newest = rows
    .filter((r) => r.baseResumeId === undefined)
    .sort((a, b) => b.createdAt - a.createdAt)
    .map((r) => ({ ...r, id: r.id!, stored: parseStoredResume(r.appliedEdits) }))
    .find((r) => r.stored !== null);
  return newest ? { ...newest, stored: newest.stored! } : null;
}

/**
 * Saves the current version of a job's tailored resume in the app and links it from the tracker
 * row. One resume per job: a newer version replaces the older one, so the table always shows the
 * latest. No file is written here (that needs a click, see exportResume).
 */
export async function storeJobResume(
  applicationId: number,
  bytes: ArrayBuffer,
  stored: StoredEngineResume,
  keywordScores: { before: number; after: number },
): Promise<number> {
  return db.transaction("rw", db.tailoredResumes, db.applications, async () => {
    const existing = await getJobResume(applicationId);
    const row: TailoredResume = {
      ...(existing ? { id: existing.id } : {}),
      applicationId,
      format: "docx",
      bytes,
      savedPath: existing?.savedPath,
      keywordScoreBefore: keywordScores.before,
      keywordScoreAfter: keywordScores.after,
      appliedEdits: JSON.stringify(stored),
      createdAt: Date.now(),
    };
    const id = await db.tailoredResumes.put(row);
    // Tailoring a resume for a job means she's applying: a checked job joins the table.
    await db.applications.update(applicationId, { tailoredResumeId: id, tailorDraft: undefined, triage: undefined, updatedAt: Date.now() });
    return id;
  });
}

export interface ExportResult {
  toFolder: boolean;
  folderWarning: string | null;
}

/**
 * Downloads the .docx and writes a copy into the resume folder's "Tailored" subfolder when she
 * has given folder access. Must be called from a click: the permission prompt needs a user gesture.
 */
export async function exportResume(bytes: ArrayBuffer, fileName: string, tailoredResumeId?: number): Promise<ExportResult> {
  const settings = await getSettings();
  let toFolder = false;
  let folderWarning: string | null = null;
  if (settings.resumeFolder) {
    try {
      if (await ensurePermission(settings.resumeFolder, "readwrite")) {
        await writeResumeFile(await getOrCreateTailoredDir(settings.resumeFolder), fileName, bytes);
        toFolder = true;
        if (tailoredResumeId !== undefined) await db.tailoredResumes.update(tailoredResumeId, { savedPath: fileName });
      } else {
        folderWarning = "Folder access was denied, so it was only downloaded.";
      }
    } catch (e) {
      folderWarning = `Couldn't write to your resume folder (${e instanceof Error ? e.message : String(e)}), so it was only downloaded.`;
    }
  }
  downloadBytes(bytes, fileName);
  return { toFolder, folderWarning };
}

/** Every job that has a master-profile resume, newest first, for the Resumes page. */
export async function listJobResumes(): Promise<{ resume: TailoredResume & { id: number }; stored: StoredEngineResume; app: Application & { id: number } }[]> {
  const [rows, apps] = await Promise.all([db.tailoredResumes.toArray(), db.applications.toArray()]);
  const byId = new Map(apps.map((a) => [a.id!, a as Application & { id: number }]));
  return rows
    .filter((r) => r.baseResumeId === undefined && byId.has(r.applicationId))
    .map((r) => ({ resume: r as TailoredResume & { id: number }, stored: parseStoredResume(r.appliedEdits), app: byId.get(r.applicationId)! }))
    .filter((x): x is typeof x & { stored: StoredEngineResume } => x.stored !== null)
    .sort((a, b) => b.resume.createdAt - a.resume.createdAt);
}

/** Removes a tailored resume from the app (not from her folder) and unlinks it from its job. */
export async function deleteJobResume(id: number): Promise<void> {
  await db.transaction("rw", db.tailoredResumes, db.applications, async () => {
    const row = await db.tailoredResumes.get(id);
    await db.tailoredResumes.delete(id);
    if (row) {
      const app = await db.applications.get(row.applicationId);
      if (app?.tailoredResumeId === id) await db.applications.update(row.applicationId, { tailoredResumeId: undefined });
    }
  });
}
