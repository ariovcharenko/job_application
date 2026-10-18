import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../../db";
import { blankApplication } from "../../tracker/blank";
import type { ReviewItem } from "./review";
import { docFingerprint, factSaveTarget, parseStoredReview, restoreReview, type StoredReview } from "./reviewState";
import { getJobResume, parseStoredResume, saveJobReview, storeJobResume, withPreviousVersion, type StoredEngineResume } from "./save";
import type { ResumeDoc } from "./schema";

const page = (bullets: string[]): ResumeDoc => ({
  education: [],
  experience: [{ title: "Software Engineer Intern", company: "Brightloop", location: "Austin, TX", dates: "May 2026 - Aug 2026", bullets }],
  skills: [{ category: "Languages", items: ["TypeScript"] }],
  leadership: [],
  meta: { matchedKeywords: [], gaps: [], valuesReflected: [] },
});

const A = "Shipped checkout features with React";
const B = "Wrote tests with Jest";
const before = page([A, B]);

const reviseComment = { id: "review:0:weak_bullet", quote: B, note: "Say what the tests caught.", target: { section: "experience" as const, entry: 0, bullet: 1 } };
const revise: ReviewItem = {
  id: "review:0:weak_bullet",
  kind: "weak_bullet",
  priority: "high",
  title: "Name the result",
  why: "Recruiters look for outcomes.",
  detail: "Say what the tests caught.",
  where: "Brightloop, bullet 2",
  target: { section: "experience", entry: 0, bullet: 1 },
  quote: B,
  fromCode: false,
  action: { type: "revise", comment: reviseComment },
};
const fact: ReviewItem = {
  id: "review:1:metric",
  kind: "metric",
  priority: "medium",
  title: "Add how many users",
  why: "Scale matters here.",
  detail: "",
  target: { section: "experience", entry: 0, bullet: 0 },
  quote: A,
  fromCode: false,
  action: { type: "ask_fact", question: "How many users did checkout reach?", change: "", target: { section: "experience", entry: 0, bullet: 0 } },
};
const whole: ReviewItem = { id: "review:2:emphasis", kind: "emphasis", priority: "low", title: "Lead with payments", why: "", detail: "Reorder.", fromCode: false, action: { type: "revise", comment: { id: "review:2:emphasis", quote: "", note: "Reorder." } } };

const review = (over: Partial<StoredReview> = {}): StoredReview => ({
  summary: "Strong on React, light on results.",
  items: [revise, fact, whole],
  queued: [{ id: revise.id, comment: reviseComment, quote: B }],
  ignored: ["code:add:go"],
  done: [],
  baseline: { total: 4, shown: 2, proven: 1 },
  fingerprint: docFingerprint(before),
  savedAt: 1,
  ...over,
});

describe("docFingerprint", () => {
  it("is the same for the same page and differs when a word changes", () => {
    expect(docFingerprint(page([A, B]))).toBe(docFingerprint(before));
    expect(docFingerprint(page([A, "Wrote tests with Vitest"]))).not.toBe(docFingerprint(before));
  });
});

describe("parseStoredReview", () => {
  it("round-trips a review through JSON", () => {
    expect(parseStoredReview(JSON.parse(JSON.stringify(review())))).toEqual(review());
  });
  it("drops broken items, and returns null for nothing usable", () => {
    const r = parseStoredReview({ ...review(), items: [revise, { id: "x", kind: "nope", title: "t", action: { type: "revise" } }, null] });
    expect(r?.items.map((i) => i.id)).toEqual([revise.id]);
    expect(parseStoredReview(undefined)).toBeNull();
    expect(parseStoredReview({ fingerprint: "f", items: [], queued: [] })).toBeNull();
    expect(parseStoredReview({ summary: "s", items: [] })).toBeNull(); // no fingerprint
  });
});

describe("restoreReview", () => {
  it("returns the review unchanged on the same page", () => {
    const r = review();
    expect(restoreReview(r, page([A, B]))).toEqual({ review: r, stale: [] });
  });

  it("on a changed page keeps every item, follows moved spots and marks gone ones done", () => {
    // B was rewritten (its spot is gone); A moved to bullet 1.
    const now = page(["Led the payments rewrite", A]);
    const { review: r, stale } = restoreReview(review(), now);
    expect(stale).toEqual([revise.id]);
    expect(r.items).toHaveLength(3);
    expect(r.done).toEqual([revise.id]);
    expect(r.queued).toEqual([]); // the queued change was for the gone bullet
    const moved = r.items.find((i) => i.id === fact.id)!;
    expect(moved.target).toEqual({ section: "experience", entry: 0, bullet: 1 });
    expect(moved.action).toMatchObject({ type: "ask_fact", target: { section: "experience", entry: 0, bullet: 1 } });
    // Whole-page advice has no spot, so it stays open.
    expect(r.done).not.toContain(whole.id);
    expect(r.fingerprint).toBe(docFingerprint(now));
    expect(r.baseline).toEqual({ total: 4, shown: 2, proven: 1 });
    expect(r.ignored).toEqual(["code:add:go"]);
  });
});

describe("the review stored with the job's resume", () => {
  const bytes = new Uint8Array([1]).buffer;
  const v = (d: ResumeDoc): StoredEngineResume => ({ v: 2, doc: d, approved: [], final: d });

  beforeEach(async () => {
    await Promise.all([db.applications.clear(), db.tailoredResumes.clear()]);
  });

  it("old rows without a review still parse", () => {
    expect(parseStoredResume(JSON.stringify(v(before)))?.review).toBeUndefined();
    expect(parseStoredResume(JSON.stringify({ ...v(before), review: { junk: true } }))?.review).toBeUndefined();
  });

  it("is kept by a new version unless that version clears it", () => {
    const withReview = withPreviousVersion(null, { ...v(before), review: review() }, 1);
    expect(withPreviousVersion(withReview, v(page([A])), 2).review).toEqual(review());
    expect(withPreviousVersion(withReview, { ...v(page([A])), review: null }, 3).review).toBeUndefined();
  });

  it("is saved and cleared on the job without a new version, and reopens with no AI call", async () => {
    const appId = await db.applications.add({ ...blankApplication(), company: "Brightloop" });
    expect(await saveJobReview(appId, review())).toBe(false); // no resume yet
    await storeJobResume(appId, bytes, v(before), { before: 0, after: 0 });
    expect(await saveJobReview(appId, review())).toBe(true);
    const row = await getJobResume(appId);
    expect(row?.stored.review).toEqual(review());
    expect(row?.stored.previous).toBeUndefined();
    // An update to the page keeps it; Start over (review: null) clears it.
    await storeJobResume(appId, bytes, v(page([A])), { before: 0, after: 0 });
    expect((await getJobResume(appId))?.stored.review?.summary).toBe(review().summary);
    await storeJobResume(appId, bytes, { ...v(page([B])), review: null }, { before: 0, after: 0 });
    expect((await getJobResume(appId))?.stored.review).toBeUndefined();
    await saveJobReview(appId, review());
    await saveJobReview(appId, null);
    expect((await getJobResume(appId))?.stored.review).toBeUndefined();
  });
});

describe("factSaveTarget", () => {
  const keys = ["experience:brightloop:software engineer intern", "projects:taskwise:"];
  it("saves only to a role she chose (or the question's own role) while the box is checked", () => {
    expect(factSaveTarget(true, keys[0], keys)).toBe(keys[0]);
    expect(factSaveTarget(false, keys[0], keys)).toBeNull();
  });
  it("never picks a role for her: no choice means nothing is saved to her experience", () => {
    expect(factSaveTarget(true, "", keys)).toBeNull();
    expect(factSaveTarget(true, "experience:gone:x", keys)).toBeNull();
  });
});
