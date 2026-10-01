import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../db";
import { blankApplication } from "../tracker/blank";
import { deleteApplication } from "../tracker/repo";
import { getJobResume, storeJobResume, type StoredEngineResume } from "./engine/save";
import { attachOwnResume, getCurrentResume, parseOwnResume, readOwnResumeFile, removeOwnResume } from "./ownResume";

const fileOf = (name: string, head: string, size?: number) => {
  const bytes = new TextEncoder().encode(head + " rest of file").buffer as ArrayBuffer;
  return { name, size: size ?? bytes.byteLength, arrayBuffer: async () => bytes };
};
const pdf = (name = "My_Resume.pdf") => fileOf(name, "%PDF-1.7");
const docx = (name = "My_Resume.docx") => fileOf(name, "PK\u0003\u0004");
const doc = {
  education: [],
  experience: [{ title: "Engineer", company: "Acme", location: "", dates: "", bullets: ["Built it"] }],
  skills: [],
  leadership: [],
  meta: { matchedKeywords: [], gaps: [], valuesReflected: [] },
};
const stored: StoredEngineResume = { v: 2, doc, approved: [], final: doc };

beforeEach(async () => {
  await Promise.all([db.applications.clear(), db.tailoredResumes.clear(), db.contacts.clear()]);
});

describe("readOwnResumeFile", () => {
  it("accepts a real PDF or .docx", async () => {
    expect((await readOwnResumeFile(pdf())).format).toBe("pdf");
    expect((await readOwnResumeFile(docx())).format).toBe("docx");
  });
  it("rejects other types, renamed files, empty and oversized files with a clear reason", async () => {
    await expect(readOwnResumeFile(fileOf("r.doc", "x"))).rejects.toThrow(/\.docx or PDF/);
    await expect(readOwnResumeFile(fileOf("r.png", "x"))).rejects.toThrow(/PDF or a Word/);
    await expect(readOwnResumeFile(fileOf("r.pdf", "PK"))).rejects.toThrow(/readable PDF/);
    await expect(readOwnResumeFile(fileOf("r.docx", "%PDF-"))).rejects.toThrow(/readable Word/);
    await expect(readOwnResumeFile(fileOf("r.pdf", "%PDF-", 0))).rejects.toThrow(/empty/);
    await expect(readOwnResumeFile(fileOf("r.pdf", "%PDF-", 6 * 1024 * 1024))).rejects.toThrow(/5 MB/);
  });
});

describe("attachOwnResume", () => {
  it("makes her file the job's resume and moves a checked job into her applications", async () => {
    const appId = await db.applications.add({ ...blankApplication(), company: "Acme", triage: "checked" });
    const id = await attachOwnResume(appId, pdf());
    const app = await db.applications.get(appId);
    expect(app?.tailoredResumeId).toBe(id);
    expect(app?.triage).toBeUndefined();
    const current = await getCurrentResume(app!);
    expect(current?.own?.fileName).toBe("My_Resume.pdf");
    expect(current?.format).toBe("pdf");
  });

  it("replaces an earlier upload but keeps the tailored resume", async () => {
    const appId = await db.applications.add({ ...blankApplication(), company: "Acme" });
    await storeJobResume(appId, new ArrayBuffer(3), stored, { before: 0, after: 0 });
    await attachOwnResume(appId, pdf("a.pdf"));
    await attachOwnResume(appId, docx("b.docx"));
    const rows = await db.tailoredResumes.where("applicationId").equals(appId).toArray();
    expect(rows.filter((r) => parseOwnResume(r.appliedEdits)).map((r) => r.savedPath)).toEqual(["b.docx"]);
    expect(await getJobResume(appId)).not.toBeNull();
  });

  it("is not mistaken for a tailored resume", async () => {
    const appId = await db.applications.add({ ...blankApplication(), company: "Acme" });
    await attachOwnResume(appId, pdf());
    expect(await getJobResume(appId)).toBeNull();
  });
});

describe("removeOwnResume", () => {
  it("falls back to the tailored resume, or to none", async () => {
    const appId = await db.applications.add({ ...blankApplication(), company: "Acme" });
    const tailored = await storeJobResume(appId, new ArrayBuffer(3), stored, { before: 0, after: 0 });
    const own = await attachOwnResume(appId, pdf());
    await removeOwnResume(own);
    expect((await db.applications.get(appId))?.tailoredResumeId).toBe(tailored);

    const other = await db.applications.add({ ...blankApplication(), company: "Beta" });
    await removeOwnResume(await attachOwnResume(other, pdf()));
    expect((await db.applications.get(other))?.tailoredResumeId).toBeUndefined();
  });

  it("is deleted along with its job", async () => {
    const appId = await db.applications.add({ ...blankApplication(), company: "Acme" });
    await attachOwnResume(appId, pdf());
    await deleteApplication(appId);
    expect(await db.tailoredResumes.count()).toBe(0);
  });
});
