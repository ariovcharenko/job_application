import { db } from "../db";
import type { Application, TailoredResume } from "../types";
import { MAX_RESUME_BYTES, ResumeFileError } from "./master/extractText";

// A resume file she made herself (PDF or Word) attached to one job, instead of or after a
// tailored one. Stored in the same tailoredResumes table so backup, delete-with-job and the
// tracker's Resume column all work unchanged; `appliedEdits` marks it as hers with the file name.
// The job's resume is whichever row `Application.tailoredResumeId` points to: tailoring again or
// uploading again simply moves that pointer to the newest one.

export interface OwnResumeMeta {
  v: "own";
  fileName: string;
}

export function parseOwnResume(appliedEdits: string): OwnResumeMeta | null {
  try {
    const raw = JSON.parse(appliedEdits);
    return raw?.v === "own" && typeof raw.fileName === "string" ? { v: "own", fileName: raw.fileName } : null;
  } catch {
    return null;
  }
}

/** Checks the file is a real PDF or .docx up to 5 MB, and returns its format and bytes. */
export async function readOwnResumeFile(file: Pick<File, "name" | "size" | "arrayBuffer">): Promise<{ format: "pdf" | "docx"; bytes: ArrayBuffer }> {
  const name = file.name;
  const ext = name.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? "";
  if (ext === "doc") throw new ResumeFileError("Old Word (.doc) files can't be previewed. Open it in Word and save it as .docx or PDF.");
  if (ext !== "pdf" && ext !== "docx") throw new ResumeFileError("Use a PDF or a Word (.docx) file.");
  if (file.size === 0) throw new ResumeFileError(`"${name}" is empty. Pick the file again.`);
  if (file.size > MAX_RESUME_BYTES) throw new ResumeFileError(`"${name}" is larger than 5 MB.`);
  const bytes = await file.arrayBuffer();
  const head = new Uint8Array(bytes.slice(0, 5));
  const isPdf = String.fromCharCode(...head) === "%PDF-";
  const isZip = head[0] === 0x50 && head[1] === 0x4b; // "PK": a .docx is a zip file
  if (ext === "pdf" && !isPdf) throw new ResumeFileError(`"${name}" isn't a readable PDF. Export it again as PDF.`);
  if (ext === "docx" && !isZip) throw new ResumeFileError(`"${name}" isn't a readable Word file. Save it again as .docx.`);
  return { format: ext, bytes };
}

/** Attaches her own file to the job and makes it the job's resume. The job joins her applications. */
export async function attachOwnResume(applicationId: number, file: Pick<File, "name" | "size" | "arrayBuffer">): Promise<number> {
  const { format, bytes } = await readOwnResumeFile(file);
  const meta: OwnResumeMeta = { v: "own", fileName: file.name };
  return db.transaction("rw", db.tailoredResumes, db.applications, async () => {
    // One own file per job: a new upload replaces the previous one.
    const old = (await db.tailoredResumes.where("applicationId").equals(applicationId).toArray()).filter((r) => parseOwnResume(r.appliedEdits));
    await db.tailoredResumes.bulkDelete(old.map((r) => r.id!));
    const row: TailoredResume = {
      applicationId,
      format,
      bytes,
      savedPath: file.name,
      keywordScoreBefore: 0,
      keywordScoreAfter: 0,
      appliedEdits: JSON.stringify(meta),
      createdAt: Date.now(),
    };
    const id = await db.tailoredResumes.add(row);
    await db.applications.update(applicationId, { tailoredResumeId: id, triage: undefined, updatedAt: Date.now() });
    return id as number;
  });
}

/** Removes her own file; the job falls back to its tailored resume when it has one. */
export async function removeOwnResume(id: number): Promise<void> {
  await db.transaction("rw", db.tailoredResumes, db.applications, async () => {
    const row = await db.tailoredResumes.get(id);
    if (!row || !parseOwnResume(row.appliedEdits)) return;
    await db.tailoredResumes.delete(id);
    const app = await db.applications.get(row.applicationId);
    if (app?.tailoredResumeId !== id) return;
    const fallback = (await db.tailoredResumes.where("applicationId").equals(row.applicationId).toArray())
      .filter((r) => r.baseResumeId === undefined && !parseOwnResume(r.appliedEdits))
      .sort((a, b) => b.createdAt - a.createdAt)[0];
    await db.applications.update(row.applicationId, { tailoredResumeId: fallback?.id, updatedAt: Date.now() });
  });
}

/** The resume the job currently points to, with whether it's her own file. */
export async function getCurrentResume(app: Pick<Application, "tailoredResumeId">): Promise<(TailoredResume & { id: number; own: OwnResumeMeta | null }) | null> {
  if (app.tailoredResumeId === undefined) return null;
  const row = await db.tailoredResumes.get(app.tailoredResumeId);
  return row ? { ...row, id: row.id!, own: parseOwnResume(row.appliedEdits) } : null;
}
