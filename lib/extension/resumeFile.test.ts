import JSZip from "jszip";
import { beforeEach, describe, expect, it } from "vitest";
import { base64ToBytes } from "../backup";
import { db, saveProfile } from "../db";
import { EXAMPLE_PROFILE, EXAMPLE_RESUME } from "../example/fixture";
import { storeJobResume } from "../resume/engine/save";
import { blankApplication } from "../tracker/blank";
import { resumeForJob } from "./resumeFile";

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()));
  await saveProfile({ ...EXAMPLE_PROFILE });
});

const bytesOf = (s: string) => new TextEncoder().encode(s).buffer as ArrayBuffer;

async function addJob(company: string, role: string) {
  return (await db.applications.add({ ...blankApplication(), company, role })) as number;
}

describe("resumeForJob", () => {
  it("renders the job's own tailored resume as a .docx", async () => {
    const id = await addJob("Northwind Labs", "Software Engineer");
    await storeJobResume(id, new ArrayBuffer(0), { v: 2, doc: EXAMPLE_RESUME, approved: [], final: EXAMPLE_RESUME }, { before: 0, after: 0 });
    const r = await resumeForJob(id);
    expect(r?.source).toBe("tailored");
    expect(r?.fileName).toMatch(/_Resume_Northwind_Labs_Software_Engineer\.docx$/);
    const zip = await JSZip.loadAsync(base64ToBytes(r!.base64));
    const xml = await zip.file("word/document.xml")!.async("string");
    expect(xml).toContain(EXAMPLE_PROFILE.fullName.split(" ")[0]);
    expect(r?.note).toBeUndefined();
  });

  it("falls back to the newest base resume with a visible note when the job has no tailored one", async () => {
    const id = await addJob("Taskwise", "SWE");
    await db.baseResumes.add({ label: "SWE", fileName: "old.docx", format: "docx", bytes: bytesOf("old"), addedAt: 1 });
    await db.baseResumes.add({ label: "SWE", fileName: "new.pdf", format: "pdf", bytes: bytesOf("new"), addedAt: 2 });
    const r = await resumeForJob(id);
    expect(r).toMatchObject({ source: "base", fileName: "new.pdf", mimeType: "application/pdf" });
    expect(r?.note).toMatch(/No tailored resume for Taskwise/);
  });

  it("says so when the page matched no job, and returns nothing without any resume", async () => {
    expect(await resumeForJob(null)).toBeNull();
    await db.baseResumes.add({ label: "SWE", fileName: "b.docx", format: "docx", bytes: bytesOf("b"), addedAt: 1 });
    expect((await resumeForJob(null))?.note).toMatch(/Couldn't tell which saved job/);
    expect((await resumeForJob(9999))?.note).toMatch(/isn't in Job Copilot/);
  });

  it("does not use an old base-resume tailoring as the job's resume", async () => {
    const id = await addJob("Taskwise", "SWE");
    await db.tailoredResumes.add({ applicationId: id, baseResumeId: 1, format: "docx", bytes: bytesOf("x"), keywordScoreBefore: 0, keywordScoreAfter: 0, appliedEdits: "{}", createdAt: 1 });
    expect(await resumeForJob(id)).toBeNull();
  });
});
