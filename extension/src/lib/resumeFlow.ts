// Puts the right resume into the application's file input. The resume comes from the app (the
// tailored .docx for the matched job, else the newest base resume), is requested only when she
// clicks Fill, and is never kept by the extension.
import type { ResumeFile } from "../protocol";
import { base64ToFile, setFileInput } from "./resumeUpload";
import type { JobMatch } from "./jobMatch";

export type ResumeOutcome =
  | { status: "uploaded"; fileName: string; source: "tailored" | "base"; note: string }
  | { status: "already-has-file"; note: string }
  | { status: "no-input"; note: string }
  | { status: "no-resume"; note: string }
  | { status: "error"; note: string };

export interface ResumeFlowDeps {
  /** Asks the app for the job's resume (background -> app). */
  requestResume(jobId: number | null): Promise<{ ok: true; resume: ResumeFile | null } | { ok: false; error: string }>;
}

/**
 * Uploads a resume into `input`. A file she already chose is never replaced. Says what happened in
 * plain words, including which resume was used and why it wasn't the tailored one.
 */
export async function uploadResumeForJob(input: HTMLInputElement | null, match: JobMatch | null, deps: ResumeFlowDeps): Promise<ResumeOutcome> {
  if (!input) return { status: "no-input", note: "No resume upload box found on this page. Upload it yourself." };
  if (input.files && input.files.length > 0) return { status: "already-has-file", note: `A resume is already attached (${input.files[0].name}). Left as is.` };
  const res = await deps.requestResume(match?.job.id ?? null);
  if (!res.ok) return { status: "error", note: res.error };
  if (!res.resume) return { status: "no-resume", note: "No resume in Job Copilot to upload. Tailor one for this job, or import a base resume." };
  try {
    setFileInput(input, base64ToFile(res.resume.base64, res.resume.fileName, res.resume.mimeType));
  } catch {
    return { status: "error", note: "The page didn't accept the file. Upload it yourself." };
  }
  const note =
    res.resume.source === "tailored"
      ? `Uploaded the resume tailored for ${match ? `${match.job.company}, ${match.job.role}` : "this job"} (${res.resume.fileName}).`
      : (res.resume.note ?? "Uploaded your base resume, not one tailored for this job.");
  return { status: "uploaded", fileName: res.resume.fileName, source: res.resume.source, note };
}
