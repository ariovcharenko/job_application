import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../../db";
import { blankApplication } from "../../tracker/blank";
import { deleteApplication } from "../../tracker/repo";
import { deleteJobResume, getJobResume, listJobResumes, parseStoredResume, storeJobResume, withPreviousVersion, type StoredEngineResume } from "./save";
import type { ResumeDoc } from "./schema";

const doc = (bullet: string): ResumeDoc => ({
  education: [],
  experience: [{ title: "Engineer", company: "Acme", location: "", dates: "May 2025 - Aug 2025", bullets: [bullet] }],
  skills: [],
  leadership: [],
  meta: { matchedKeywords: [], gaps: [], valuesReflected: [] },
});
const stored = (bullet: string, approved: string[] = []): StoredEngineResume => ({ v: 2, doc: doc(bullet), approved, final: doc(bullet) });
const bytes = new Uint8Array([1, 2, 3]).buffer;

beforeEach(async () => {
  await Promise.all([db.applications.clear(), db.tailoredResumes.clear(), db.contacts.clear()]);
});

describe("parseStoredResume", () => {
  it("reads the current format with her ticks", () => {
    expect(parseStoredResume(JSON.stringify(stored("Built it", ["x"])))?.approved).toEqual(["x"]);
  });
  it("reads an older row that stored only the final document", () => {
    const r = parseStoredResume(JSON.stringify(doc("Old")));
    expect(r?.final.experience[0].bullets).toEqual(["Old"]);
    expect(r?.approved).toEqual([]);
  });
  it("returns null for the old base-resume edit format or bad JSON", () => {
    expect(parseStoredResume(JSON.stringify({ bulletEdits: [] }))).toBeNull();
    expect(parseStoredResume("{")).toBeNull();
  });
});

describe("storeJobResume", () => {
  it("links the resume from the job and replaces it with the latest version", async () => {
    const appId = await db.applications.add({ ...blankApplication(), company: "Acme" });
    const first = await storeJobResume(appId, bytes, stored("v1"), { before: 40, after: 70 });
    const second = await storeJobResume(appId, bytes, stored("v2"), { before: 40, after: 80 });
    expect(second).toBe(first);
    expect(await db.tailoredResumes.count()).toBe(1);
    expect((await db.applications.get(appId))?.tailoredResumeId).toBe(first);
    expect((await getJobResume(appId))?.stored.final.experience[0].bullets).toEqual(["v2"]);
  });

  it("lists saved resumes with their job, and deleting one unlinks it", async () => {
    const appId = await db.applications.add({ ...blankApplication(), company: "Acme" });
    const id = await storeJobResume(appId, bytes, stored("v1"), { before: 0, after: 0 });
    expect((await listJobResumes()).map((r) => r.app.company)).toEqual(["Acme"]);
    await deleteJobResume(id);
    expect(await listJobResumes()).toEqual([]);
    expect((await db.applications.get(appId))?.tailoredResumeId).toBeUndefined();
  });
});

describe("earlier versions", () => {
  it("keeps the last 3 versions a new one replaced, newest first, and none for a tick-only save", async () => {
    const appId = await db.applications.add({ ...blankApplication(), company: "Acme" });
    for (const v of ["v1", "v2", "v3", "v4", "v5"]) await storeJobResume(appId, bytes, stored(v), { before: 0, after: 0 });
    await storeJobResume(appId, bytes, stored("v5", ["kept a flag"]), { before: 0, after: 0 });
    const s = (await getJobResume(appId))!.stored;
    expect(s.final.experience[0].bullets).toEqual(["v5"]);
    expect(s.approved).toEqual(["kept a flag"]);
    expect(s.previous?.map((p) => p.final.experience[0].bullets[0])).toEqual(["v4", "v3", "v2"]);
  });

  it("still reads rows saved before versions existed, and drops a broken earlier version", () => {
    const old = { v: 2, doc: doc("Old"), approved: [], final: doc("Old") };
    expect(parseStoredResume(JSON.stringify(old))?.previous).toBeUndefined();
    const mixed = { ...old, previous: [{ doc: doc("A"), final: doc("A"), approved: ["x"], savedAt: 5 }, { doc: "broken" }] };
    expect(parseStoredResume(JSON.stringify(mixed))?.previous).toEqual([{ doc: doc("A"), final: doc("A"), approved: ["x"], savedAt: 5 }]);
  });

  it("withPreviousVersion never nests earlier versions inside earlier versions", () => {
    const a = withPreviousVersion(null, stored("a"), 1);
    const b = withPreviousVersion(a, stored("b"), 2);
    const c = withPreviousVersion(b, { ...stored("c"), previous: [{ ...stored("zzz"), savedAt: 0 }] }, 3);
    expect(c.previous?.map((p) => p.final.experience[0].bullets[0])).toEqual(["b", "a"]);
    expect(c.previous?.every((p) => !("previous" in p))).toBe(true);
  });
});

describe("deleteApplication", () => {
  it("also deletes the job's resumes and contacts", async () => {
    const appId = await db.applications.add({ ...blankApplication(), company: "Acme" });
    await storeJobResume(appId, bytes, stored("v1"), { before: 0, after: 0 });
    await db.contacts.add({ applicationId: appId, name: "R", role: "", linkedinUrl: "", type: "recruiter", status: "to-contact", draft: "" });
    await deleteApplication(appId);
    expect(await db.applications.count()).toBe(0);
    expect(await db.tailoredResumes.count()).toBe(0);
    expect(await db.contacts.count()).toBe(0);
  });
});
