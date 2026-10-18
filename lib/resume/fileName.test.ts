import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../db";
import { fileExists } from "../fsAccess";
import { blankApplication } from "../tracker/blank";
import { ownFileNames } from "./engine/save";
import { chooseTailoredFileName, jobTag, tailoredFileName, withSuffix } from "./fileName";

// A tiny in-memory folder with the parts of FileSystemDirectoryHandle the code uses.
class Dir {
  files = new Map<string, string>();
  async getFileHandle(name: string) {
    if (this.files.has(name)) return { name };
    throw new DOMException("not found", "NotFoundError");
  }
}
const h = (d: Dir) => d as unknown as FileSystemDirectoryHandle;

beforeEach(async () => {
  await Promise.all([db.applications.clear(), db.tailoredResumes.clear()]);
});

describe("jobTag / withSuffix", () => {
  it("is short, stable and differs between jobs", () => {
    expect(jobTag(7)).toMatch(/^[0-9a-z]{4}$/);
    expect(jobTag(7)).toBe(jobTag(7));
    expect(jobTag(7)).not.toBe(jobTag(8));
  });
  it("puts the tag before the extension", () => {
    expect(withSuffix("Alex_Rivera_Resume_Stripe.docx", "ab12")).toBe("Alex_Rivera_Resume_Stripe_ab12.docx");
    expect(withSuffix("Alex_Rivera_Resume_Stripe.docx", "ab12", 2)).toBe("Alex_Rivera_Resume_Stripe_ab12_2.docx");
  });
});

describe("chooseTailoredFileName", () => {
  const name = tailoredFileName("Alex Rivera", "Brightloop", "Software Engineer");

  it("uses the plain name when the folder doesn't have it", async () => {
    const dir = new Dir();
    expect(await chooseTailoredFileName(name, { exists: (n) => fileExists(h(dir), n), ownNames: new Set(), applicationId: 1 })).toBe(name);
  });

  it("replaces this job's own earlier copy", async () => {
    const dir = new Dir();
    dir.files.set(name, "old version of this job");
    expect(await chooseTailoredFileName(name, { exists: (n) => fileExists(h(dir), n), ownNames: new Set([name]), applicationId: 1 })).toBe(name);
  });

  it("never overwrites another job's file with the same company and title", async () => {
    const dir = new Dir();
    dir.files.set(name, "the other job's resume");
    const chosen = await chooseTailoredFileName(name, { exists: (n) => fileExists(h(dir), n), ownNames: new Set(), applicationId: 2 });
    expect(chosen).toBe(withSuffix(name, jobTag(2)));
    // And a third job with the same name doesn't take the second one's either.
    dir.files.set(chosen, "second job");
    const third = await chooseTailoredFileName(name, { exists: (n) => fileExists(h(dir), n), ownNames: new Set(), applicationId: 3 });
    expect(third).not.toBe(name);
    expect(third).not.toBe(chosen);
  });

  it("knows a job's own names from the database", async () => {
    const a = await db.applications.add({ ...blankApplication(), company: "Brightloop", role: "Software Engineer" });
    const b = await db.applications.add({ ...blankApplication(), company: "Brightloop", role: "Software Engineer" });
    const base = { format: "docx" as const, bytes: new ArrayBuffer(0), keywordScoreBefore: 0, keywordScoreAfter: 0, appliedEdits: "{}", createdAt: 1 };
    const ra = await db.tailoredResumes.add({ ...base, applicationId: a, savedPath: name });
    const rb = await db.tailoredResumes.add({ ...base, applicationId: b });
    expect((await ownFileNames(ra)).ownNames.has(name)).toBe(true);
    const forB = await ownFileNames(rb);
    expect(forB.applicationId).toBe(b);
    expect(forB.ownNames.has(name)).toBe(false);
  });
});
