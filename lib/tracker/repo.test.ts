import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../db";
import type { FeedItem } from "../types";
import { blankApplication } from "./blank";
import { dismissFeedItem, setTriage, startApplicationFromFeed } from "./repo";

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
