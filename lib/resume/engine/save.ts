import { downloadBlob } from "../../download";
import { db, getSettings } from "../../db";
import { ensurePermission, fileExists, getOrCreateTailoredDir, writeResumeFile } from "../../fsAccess";
import { chooseTailoredFileName } from "../fileName";
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
  /**
   * Up to MAX_PREVIOUS_VERSIONS earlier versions, newest first, so a new version (a Start over, an
   * update) never silently replaces the one she had. Optional: older rows have none.
   */
  previous?: PreviousVersion[];
}

/** An earlier saved version of a job's resume. */
export interface PreviousVersion {
  doc: ResumeDoc;
  approved: string[];
  final: ResumeDoc;
  savedAt: number;
}

export const MAX_PREVIOUS_VERSIONS = 3;

function parsePrevious(raw: unknown): PreviousVersion[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .flatMap((p) => {
      const doc = ResumeDocSchema.safeParse(p?.doc);
      const final = ResumeDocSchema.safeParse(p?.final);
      if (!doc.success || !final.success) return [];
      const approved = Array.isArray(p.approved) ? p.approved.filter((a: unknown): a is string => typeof a === "string") : [];
      return [{ doc: doc.data, final: final.data, approved, savedAt: typeof p.savedAt === "number" ? p.savedAt : 0 }];
    })
    .slice(0, MAX_PREVIOUS_VERSIONS);
}

/** Reads appliedEdits back. Older rows stored just the final document; those reopen with no ticks. */
export function parseStoredResume(appliedEdits: string): StoredEngineResume | null {
  try {
    const raw = JSON.parse(appliedEdits);
    if (raw?.v === 2) {
      const previous = parsePrevious(raw.previous);
      return {
        v: 2,
        doc: ResumeDocSchema.parse(raw.doc),
        approved: Array.isArray(raw.approved) ? raw.approved : [],
        final: ResumeDocSchema.parse(raw.final),
        ...(previous.length ? { previous } : {}),
      };
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

const sameDoc = (a: ResumeDoc, b: ResumeDoc) => JSON.stringify(a) === JSON.stringify(b);

/**
 * The stored JSON for a new version: the version it replaces goes to the front of `previous`
 * (at most MAX_PREVIOUS_VERSIONS kept), unless only her ticks changed (same page), which isn't a
 * new version. Pure, tested.
 */
export function withPreviousVersion(existing: StoredEngineResume | null, next: StoredEngineResume, savedAt: number): StoredEngineResume {
  const current: StoredEngineResume = { v: 2, doc: next.doc, approved: next.approved, final: next.final };
  if (!existing) return current;
  const kept = existing.previous ?? [];
  if (sameDoc(existing.final, next.final) && sameDoc(existing.doc, next.doc)) return kept.length ? { ...current, previous: kept } : current;
  const older: PreviousVersion = { doc: existing.doc, approved: existing.approved, final: existing.final, savedAt };
  return { ...current, previous: [older, ...kept].slice(0, MAX_PREVIOUS_VERSIONS) };
}

/**
 * Saves the current version of a job's tailored resume in the app and links it from the tracker
 * row. One row per job, always the latest, with the last few versions it replaced kept inside it
 * (withPreviousVersion). No file is written here (that needs a click, see exportResume).
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
      appliedEdits: JSON.stringify(withPreviousVersion(existing?.stored ?? null, stored, existing?.createdAt ?? Date.now())),
      createdAt: Date.now(),
    };
    const id = await db.tailoredResumes.put(row);
    // Tailoring a resume for a job means she's applying: a checked job joins the table.
    await db.applications.update(applicationId, { tailoredResumeId: id, tailorDraft: undefined, triage: undefined, updatedAt: Date.now() });
    return id;
  });
}

export interface ExportResult {
  /** The name it was saved and downloaded under: a short tag is added when the folder already
   * has another job's file with the plain name. */
  fileName: string;
  toFolder: boolean;
  folderWarning: string | null;
}

/**
 * Downloads the .docx and writes a copy into her Tailored folder (next to Base, never inside it;
 * see getOrCreateTailoredDir). Must be called from a click: the permission prompt needs a user gesture.
 */
export async function exportResume(bytes: ArrayBuffer, requestedName: string, tailoredResumeId?: number): Promise<ExportResult> {
  const settings = await getSettings();
  let fileName = requestedName;
  let toFolder = false;
  let folderWarning: string | null = null;
  const chosen = settings.tailoredFolder;
  const access = chosen ?? settings.resumeFolder;
  if (access) {
    try {
      if (await ensurePermission(access, "readwrite")) {
        const dir = await getOrCreateTailoredDir(settings.resumeFolder ?? access, chosen);
        if (dir) {
          fileName = await chooseTailoredFileName(requestedName, { exists: (n) => fileExists(dir, n), ...(await ownFileNames(tailoredResumeId)) });
          await writeResumeFile(dir, fileName, bytes);
          toFolder = true;
          if (tailoredResumeId !== undefined) await db.tailoredResumes.update(tailoredResumeId, { savedPath: fileName });
        } else {
          folderWarning = "To also save a copy, choose your Tailored folder on the Resumes page (Resume folder).";
        }
      } else {
        folderWarning = "Folder access was denied, so it was only downloaded.";
      }
    } catch (e) {
      folderWarning = `Couldn't write to your Tailored folder (${e instanceof Error ? e.message : String(e)}), so it was only downloaded.`;
    }
  }
  downloadBytes(bytes, fileName);
  return { fileName, toFolder, folderWarning };
}

/** The job a tailored resume belongs to, and the names that job's resumes were saved under. */
export async function ownFileNames(tailoredResumeId?: number): Promise<{ applicationId?: number; ownNames: Set<string> }> {
  const row = tailoredResumeId !== undefined ? await db.tailoredResumes.get(tailoredResumeId) : undefined;
  if (!row) return { ownNames: new Set() };
  const rows = await db.tailoredResumes.where("applicationId").equals(row.applicationId).toArray();
  return { applicationId: row.applicationId, ownNames: new Set(rows.map((r) => r.savedPath).filter((p): p is string => !!p)) };
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
