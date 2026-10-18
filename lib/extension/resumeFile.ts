import { bytesToBase64 } from "../backup";
import { db, getBaseResumes, getProfile } from "../db";
import { tailoredFileName } from "../resume/fileName";
import { buildHeader } from "../resume/engine";
import { getJobResume } from "../resume/engine/save";
import type { ResumeFile } from "./protocol";

const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const PDF = "application/pdf";

/**
 * The resume file the extension uploads for a job. The job's own tailored resume when it has one
 * (re-rendered here as a .docx from the saved page and her current Profile header, so the file is
 * the same one the Download button writes), otherwise her newest base resume with a note saying
 * why, otherwise nothing. The .docx writer loads only now (it is heavy), not with every page.
 */
export async function resumeForJob(jobId: number | null): Promise<ResumeFile | null> {
  const profile = await getProfile();
  let note: string | undefined;

  if (jobId !== null) {
    const app = await db.applications.get(jobId);
    const saved = app ? await getJobResume(jobId) : null;
    if (app && saved) {
      const fileName = tailoredFileName(profile.fullName, app.company, app.role);
      try {
        const { renderResumeDocx } = await import("../resume/engine/render");
        const bytes = await renderResumeDocx(buildHeader(profile), saved.stored.final);
        return { fileName, base64: bytesToBase64(bytes), mimeType: DOCX, source: "tailored" };
      } catch {
        if (saved.bytes && saved.bytes.byteLength > 0) return { fileName, base64: bytesToBase64(saved.bytes), mimeType: DOCX, source: "tailored" };
      }
    }
    note = app
      ? `No tailored resume for ${app.company} yet. Tailor one in Job Copilot first, or this base resume is used.`
      : "That job isn't in Job Copilot anymore.";
  } else {
    note = "Couldn't tell which saved job this page is. Using your base resume. Add the job in Job Copilot to get its tailored resume.";
  }

  const base = [...(await getBaseResumes())].sort((a, b) => b.addedAt - a.addedAt)[0];
  if (!base) return null;
  return { fileName: base.fileName, base64: bytesToBase64(base.bytes), mimeType: base.format === "pdf" ? PDF : DOCX, source: "base", note: `${note} (${base.fileName})` };
}
