import { describe, expect, it, vi } from "vitest";
import { uploadResumeForJob } from "./resumeFlow";
import type { JobMatch } from "./jobMatch";

const match: JobMatch = { by: "link", job: { id: 7, company: "Taskwise", role: "SWE", url: "u", stage: "Saved" } };
const fileInput = (files: { name: string }[] = []) => {
  const events: string[] = [];
  return { input: { files: files.length ? (files as unknown as FileList) : null, dispatchEvent: (e: Event) => (events.push(e.type), true) } as unknown as HTMLInputElement, events };
};
const tailored = { fileName: "Alex_Rivera_Resume_Taskwise.docx", base64: btoa("docx"), mimeType: "application/x", source: "tailored" as const };

describe("uploadResumeForJob", () => {
  it("uploads the tailored resume for the matched job and says so", async () => {
    const { input, events } = fileInput();
    const requestResume = vi.fn(async () => ({ ok: true as const, resume: tailored }));
    const r = await uploadResumeForJob(input, match, { requestResume });
    expect(requestResume).toHaveBeenCalledWith(7);
    expect(r).toMatchObject({ status: "uploaded", source: "tailored" });
    expect(r.note).toContain("Taskwise");
    expect(input.files?.[0].name).toBe("Alex_Rivera_Resume_Taskwise.docx");
    expect(events).toEqual(["input", "change"]);
  });
  it("shows the app's note when a base resume was used instead", async () => {
    const { input } = fileInput();
    const r = await uploadResumeForJob(input, null, { requestResume: async () => ({ ok: true, resume: { ...tailored, source: "base", note: "No tailored resume for Taskwise yet. (base.docx)" } }) });
    expect(r).toMatchObject({ status: "uploaded", source: "base" });
    expect(r.note).toMatch(/No tailored resume/);
  });
  it("never replaces a file she already attached, and never asks the app", async () => {
    const { input } = fileInput([{ name: "mine.pdf" }]);
    const requestResume = vi.fn();
    expect((await uploadResumeForJob(input, match, { requestResume })).status).toBe("already-has-file");
    expect(requestResume).not.toHaveBeenCalled();
  });
  it("reports a missing input, a missing resume and an app error", async () => {
    expect((await uploadResumeForJob(null, match, { requestResume: vi.fn() })).status).toBe("no-input");
    expect((await uploadResumeForJob(fileInput().input, match, { requestResume: async () => ({ ok: true, resume: null }) })).status).toBe("no-resume");
    expect(await uploadResumeForJob(fileInput().input, match, { requestResume: async () => ({ ok: false, error: "Job Copilot isn't open." }) })).toEqual({ status: "error", note: "Job Copilot isn't open." });
  });
});
