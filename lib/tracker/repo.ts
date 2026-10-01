import { db } from "../db";
import type { Application, FeedItem, Stage } from "../types";
import { blankApplication } from "./blank";
import { dedupeKey, normalizeRoleType } from "./csvMap";
import { applyStageChange } from "./stage";

export async function saveApplication(app: Application): Promise<number> {
  const now = Date.now();
  if (app.id === undefined) {
    return db.applications.add({ ...app, createdAt: now, updatedAt: now });
  }
  await db.applications.put({ ...app, updatedAt: now });
  return app.id;
}

/** Deletes a job and everything attached to it: its tailored resumes and outreach contacts. */
export async function deleteApplication(id: number): Promise<void> {
  await db.transaction("rw", db.applications, db.tailoredResumes, db.contacts, async () => {
    await db.tailoredResumes.where("applicationId").equals(id).delete();
    await db.contacts.where("applicationId").equals(id).delete();
    await db.applications.delete(id);
  });
}

/**
 * Moves a job between the table (undefined), Checked jobs ("checked") and Not applying ("skipped").
 * Writes only that field on the stored row, so a stale copy of the job can't overwrite newer edits.
 */
export async function setTriage(id: number, triage: Application["triage"]): Promise<void> {
  await db.applications.update(id, { triage, updatedAt: Date.now() });
}

export async function changeStage(app: Application, stage: Stage): Promise<void> {
  await saveApplication(applyStageChange(app, stage));
}

/** Add imported rows, skipping any that match an existing company + position + link. Returns counts. */
export async function importApplications(incoming: Application[]): Promise<{ added: number; skipped: number }> {
  const existing = new Set((await db.applications.toArray()).map(dedupeKey));
  const fresh: Application[] = [];
  let skipped = 0;
  for (const a of incoming) {
    const key = dedupeKey(a);
    if (existing.has(key)) {
      skipped++;
      continue;
    }
    existing.add(key);
    fresh.push(a);
  }
  if (fresh.length) await db.applications.bulkAdd(fresh);
  return { added: fresh.length, skipped };
}

export async function setFeedItemState(id: number, state: FeedItem["state"]): Promise<void> {
  await db.feed.update(id, { state });
}

export async function dismissFeedItem(id: number): Promise<void> {
  await setFeedItemState(id, "dismissed");
}

/** Turns a feed match into a tracked application (source "Feed"), and marks the feed row as started. */
export async function startApplicationFromFeed(item: FeedItem): Promise<number> {
  const id = await saveApplication({
    ...blankApplication(),
    company: item.company,
    role: item.title,
    url: item.url,
    location: item.location,
    workMode: item.workMode,
    visa: item.visa,
    roleType: normalizeRoleType(item.title),
    source: "Feed",
    jdText: item.jdText,
    fitScore: item.fitScore,
    fitBreakdown: item.fitBreakdown,
    tailorDraft: item.tailorDraft,
  });
  if (item.id !== undefined) await setFeedItemState(item.id, "started");
  return id;
}
