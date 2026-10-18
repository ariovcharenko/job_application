import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../db";
import type { FeedItem } from "../types";
import { blankApplication } from "./blank";
import { changedFields, changeStage, dismissFeedItem, saveApplicationChanges, setTriage, startApplicationFromFeed } from "./repo";

function feedItem(overrides: Partial<FeedItem> = {}): FeedItem {
  return {
    source: "jsearch",
    externalId: "abc",
    url: "https://acme.example/jobs/1",
    company: "Acme",
    title: "Software Engineer, New Grad",
    location: "Remote",
    workMode: "Remote",
    visa: "sponsors",
    jdText: "We are hiring a software engineer...",
    firstSeen: Date.now(),
    fitScore: 88,
    fitBreakdown: JSON.stringify({ score: 88 }),
    state: "new",
    ...overrides,
  };
}

beforeEach(async () => {
  await db.feed.clear();
  await db.applications.clear();
});

describe("startApplicationFromFeed", () => {
  it("creates a tracked application carrying over the feed item's details", async () => {
    const feedId = await db.feed.add(feedItem());
    const item = (await db.feed.get(feedId))!;

    const appId = await startApplicationFromFeed(item);
    const app = await db.applications.get(appId);

    expect(app).toMatchObject({
      company: "Acme",
      role: "Software Engineer, New Grad",
      url: "https://acme.example/jobs/1",
      roleType: "Software Engineering",
      source: "Feed",
      visa: "sponsors",
      fitScore: 88,
      stage: "Saved",
    });
  });

  it("marks the feed row as started", async () => {
    const feedId = await db.feed.add(feedItem());
    await startApplicationFromFeed((await db.feed.get(feedId))!);
    expect((await db.feed.get(feedId))?.state).toBe("started");
  });
});

describe("dismissFeedItem", () => {
  it("marks a feed row as dismissed without touching the applications table", async () => {
    const id = await db.feed.add(feedItem());
    await dismissFeedItem(id);
    expect((await db.feed.get(id))?.state).toBe("dismissed");
    expect(await db.applications.count()).toBe(0);
  });
});

describe("setTriage", () => {
  it("moves a job between Checked jobs, Not applying and the table without touching other fields", async () => {
    const id = await db.applications.add({ ...blankApplication(), company: "Acme", notes: "newer note", triage: "checked" });
    await setTriage(id, "skipped");
    expect((await db.applications.get(id))?.triage).toBe("skipped");
    await setTriage(id, undefined);
    const row = await db.applications.get(id);
    expect(row?.triage).toBeUndefined();
    expect("triage" in (row ?? {})).toBe(false);
    expect(row?.notes).toBe("newer note");
  });
});

describe("saveApplicationChanges (no whole-record writes from stale copies)", () => {
  it("writes only her edits, keeping a fit breakdown stored in the background meanwhile", async () => {
    const id = await db.applications.add({ ...blankApplication(), company: "Brightloop", role: "Engineer", fitBreakdown: "old" });
    const base = (await db.applications.get(id))!;
    // The must-have re-check refreshes the stored analysis while the form is open.
    await db.applications.update(id, { fitBreakdown: "new" });
    const edited = { ...base, notes: "Talked to Alex" };
    expect(changedFields(edited, base)).toEqual({ notes: "Talked to Alex" });
    await saveApplicationChanges(edited, base);
    const row = (await db.applications.get(id))!;
    expect(row.notes).toBe("Talked to Alex");
    expect(row.fitBreakdown).toBe("new");
  });

  it("removes a field cleared in the edit", async () => {
    const id = await db.applications.add({ ...blankApplication(), company: "Brightloop", triage: "checked" });
    const base = (await db.applications.get(id))!;
    const next = { ...base };
    delete next.triage;
    await saveApplicationChanges(next, base);
    expect((await db.applications.get(id))!.triage).toBeUndefined();
  });

  it("a stage change from the table doesn't undo a Details edit saved meanwhile", async () => {
    const id = await db.applications.add({ ...blankApplication(), company: "Brightloop" });
    const stale = (await db.applications.get(id))!;
    await db.applications.update(id, { salary: "$120k" });
    await changeStage(stale, "Applied");
    const row = (await db.applications.get(id))!;
    expect(row.stage).toBe("Applied");
    expect(row.salary).toBe("$120k");
  });

  it("doesn't recreate a job deleted meanwhile", async () => {
    const id = await db.applications.add({ ...blankApplication(), company: "Brightloop" });
    const base = (await db.applications.get(id))!;
    await db.applications.delete(id);
    await expect(saveApplicationChanges({ ...base, notes: "x" }, base)).rejects.toThrow(/deleted/);
    expect(await db.applications.get(id)).toBeUndefined();
  });
});
