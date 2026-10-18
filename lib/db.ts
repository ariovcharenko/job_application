import Dexie, { type Table } from "dexie";
import { DEFAULT_PROFILE, DEFAULT_SETTINGS } from "./defaults";
import { migratePreferences } from "./eligibility/migrate";
import { migrateRoleType } from "./eligibility/roles";
import type {
  AIUsageEntry,
  AnswerBankEntry,
  AppSettings,
  Application,
  BaseResume,
  Contact,
  MasterSaveReason,
  FeedItem,
  Preferences,
  Profile,
  TailoredResume,
  TextDoc,
} from "./types";

class JobDB extends Dexie {
  settings!: Table<AppSettings, string>;
  profile!: Table<Profile, string>;
  preferences!: Table<Preferences, string>;
  answerBank!: Table<AnswerBankEntry, number>;
  baseResumes!: Table<BaseResume, number>;
  applications!: Table<Application, number>;
  feed!: Table<FeedItem, number>;
  tailoredResumes!: Table<TailoredResume, number>;
  contacts!: Table<Contact, number>;
  docs!: Table<TextDoc, string>;
  aiUsage!: Table<AIUsageEntry, number>;

  constructor() {
    super("job-application-copilot");
    this.version(1).stores({
      settings: "id",
      profile: "id",
      preferences: "id",
      answerBank: "++id, *tags",
      baseResumes: "++id, label",
      applications: "++id, status, company, fitScore, createdAt",
      feed: "++id, state, fitScore, [source+externalId], firstSeen",
      tailoredResumes: "++id, applicationId",
      contacts: "++id, applicationId, status",
    });
    // v2: applications get the user's Notion fields; `status` becomes `stage`, dates become strings.
    this.version(2)
      .stores({ applications: "++id, stage, company, fitScore, appliedDate, createdAt" })
      .upgrade((tx) =>
        tx
          .table("applications")
          .toCollection()
          .modify((a: Record<string, unknown>) => {
            const oldStage = a.status === "Interview" ? "Waiting for interview" : a.status === "Tailored" ? "Saved" : a.status;
            Object.assign(a, {
              stage: oldStage ?? "Saved",
              appliedDate: "",
              respondDate: "",
              referral: "",
              tailoredUrl: "",
              contactName: "",
              contactLinkedin: "",
              roleType: "Other",
              visa: "unknown",
              followUpDate: "",
            });
            delete a.status;
          }),
      );
    // v3: free-form text documents (the master profile for resume tailoring).
    this.version(3).stores({ docs: "id" });
    // v4: eligibility driven by the candidate. Preferences: old must-haves and regions become the
    // new must-haves, experience level and location choices (lib/eligibility/migrate.ts). Role
    // types: her four families become the wider list (SWE -> Software Engineering, ...).
    this.version(4)
      .stores({})
      .upgrade(async (tx) => {
        await tx
          .table("preferences")
          .toCollection()
          .modify((p: Record<string, unknown>) => {
            const next = migratePreferences(p) as unknown as Record<string, unknown>;
            for (const k of Object.keys(p)) if (!(k in next)) delete p[k];
            Object.assign(p, next);
          });
        await tx
          .table("applications")
          .toCollection()
          .modify((a: Record<string, unknown>) => {
            a.roleType = migrateRoleType(a.roleType as string | undefined, (a.role as string) ?? "");
          });
        await tx
          .table("baseResumes")
          .toCollection()
          .modify((r: Record<string, unknown>) => {
            if (typeof r.label === "string" && ["SWE", "AI Engineer", "Product", "UX/UI"].includes(r.label)) r.label = migrateRoleType(r.label);
          });
      });
    // v5: a local log of AI token use, for "AI spend this month" (lib/ai/usage.ts). A new table
    // only: no existing row changes.
    this.version(5).stores({ aiUsage: "++id, at" });
  }
}

export const db = new JobDB();

// Singleton records: read with defaults filled in, so callers never see undefined fields.
export async function getSettings(): Promise<AppSettings> {
  return { ...DEFAULT_SETTINGS, ...(await db.settings.get("app")) };
}
export async function saveSettings(patch: Partial<AppSettings>): Promise<void> {
  await db.settings.put({ ...(await getSettings()), ...patch, id: "app" });
}

export async function getProfile(): Promise<Profile> {
  return { ...DEFAULT_PROFILE, ...(await db.profile.get("me")) };
}
export async function saveProfile(profile: Profile): Promise<void> {
  await db.profile.put({ ...profile, id: "me" });
}

// ---- "Your experience" (the master profile) and its kept earlier versions ----
//
// Every save that replaces different text first keeps the old text as a version row in the same
// `docs` table (string ids, so no schema change): always for an import, a tailoring addition or a
// restore, and at most every MASTER_EDIT_SNAPSHOT_MS while she types. Only the newest
// MASTER_VERSIONS_KEPT are kept. Nothing is ever lost to a stale editor or a second tab.

export const MASTER_ID = "masterProfile";
export const MASTER_VERSIONS_KEPT = 10;
export const MASTER_EDIT_SNAPSHOT_MS = 10 * 60 * 1000;

export async function getMasterProfile(): Promise<string> {
  return (await db.docs.get(MASTER_ID))?.text ?? "";
}

/** The current master profile record (text + when it was saved), or undefined if never saved. */
export async function getMasterProfileDoc(): Promise<TextDoc | undefined> {
  return db.docs.get(MASTER_ID);
}

/** Kept earlier versions, newest first. */
export async function listMasterVersions(): Promise<TextDoc[]> {
  const rows = await db.docs.filter((d) => d.versionOf === MASTER_ID).toArray();
  return rows.sort((a, b) => (b.savedAt ?? 0) - (a.savedAt ?? 0));
}

export interface SaveMasterOptions {
  /** Why it changes. "edit" (typing in the editor) keeps a version at most every 10 minutes. */
  reason?: MasterSaveReason;
  /**
   * Only save if the stored record still has this `updatedAt` (what the editor loaded). If it
   * changed meanwhile (another tab, a skill added while tailoring), nothing is written and the
   * result says so. Leave undefined to save regardless.
   */
  expectedUpdatedAt?: number | null;
  now?: number;
}

export type SaveMasterResult = { ok: true; updatedAt: number } | { ok: false; current: TextDoc };

export async function saveMasterProfileChecked(text: string, opts: SaveMasterOptions = {}): Promise<SaveMasterResult> {
  const reason = opts.reason ?? "other";
  return db.transaction("rw", db.docs, async () => {
    const current = await db.docs.get(MASTER_ID);
    if (opts.expectedUpdatedAt !== undefined && (current?.updatedAt ?? null) !== opts.expectedUpdatedAt) {
      if (current && current.text !== text) return { ok: false, current } as const;
    }
    // Strictly increasing, so two saves in the same millisecond still look different to a checker.
    const now = Math.max(opts.now ?? Date.now(), (current?.updatedAt ?? 0) + 1);
    if (current && current.text.trim() && current.text !== text) {
      const versions = await db.docs.filter((d) => d.versionOf === MASTER_ID).toArray();
      const newest = Math.max(0, ...versions.map((v) => v.savedAt ?? 0));
      if (reason !== "edit" || now - newest >= MASTER_EDIT_SNAPSHOT_MS) {
        await db.docs.put({ id: `${MASTER_ID}@${now}`, text: current.text, updatedAt: current.updatedAt, versionOf: MASTER_ID, savedAt: now, reason });
        const sorted = [...versions.map((v) => ({ id: v.id, savedAt: v.savedAt ?? 0 })), { id: `${MASTER_ID}@${now}`, savedAt: now }].sort((a, b) => b.savedAt - a.savedAt);
        const drop = sorted.slice(MASTER_VERSIONS_KEPT).map((v) => v.id);
        if (drop.length) await db.docs.bulkDelete(drop);
      }
    }
    if (current?.text === text) return { ok: true, updatedAt: current.updatedAt } as const;
    await db.docs.put({ id: MASTER_ID, text, updatedAt: now });
    return { ok: true, updatedAt: now } as const;
  });
}

/** Saves "Your experience", keeping the text it replaces as a version (see above). */
export async function saveMasterProfile(text: string, reason: MasterSaveReason = "other"): Promise<void> {
  await saveMasterProfileChecked(text, { reason });
}

/** Makes a kept version current again. What it replaces is kept as a version too. */
export async function restoreMasterVersion(id: string): Promise<string> {
  const v = await db.docs.get(id);
  if (!v || v.versionOf !== MASTER_ID) throw new Error("That earlier version is no longer kept.");
  await saveMasterProfile(v.text, "restore");
  return v.text;
}

export async function getBaseResumes(): Promise<BaseResume[]> {
  return db.baseResumes.toArray();
}
export async function saveBaseResume(resume: BaseResume): Promise<number> {
  return db.baseResumes.put(resume);
}
export async function deleteBaseResume(id: number): Promise<void> {
  await db.baseResumes.delete(id);
}

export async function getTailoredResume(id: number): Promise<TailoredResume | undefined> {
  return db.tailoredResumes.get(id);
}
export async function saveTailoredResume(resume: TailoredResume): Promise<number> {
  return db.tailoredResumes.put(resume);
}

export async function getAnswerBank(): Promise<AnswerBankEntry[]> {
  return db.answerBank.toArray();
}
export async function saveAnswerBankEntry(entry: AnswerBankEntry): Promise<number> {
  return db.answerBank.put(entry);
}
export async function deleteAnswerBankEntry(id: number): Promise<void> {
  await db.answerBank.delete(id);
}

export async function getContactsForApplication(applicationId: number): Promise<Contact[]> {
  return db.contacts.where("applicationId").equals(applicationId).toArray();
}
export async function saveContact(contact: Contact): Promise<number> {
  return db.contacts.put(contact);
}
export async function deleteContact(id: number): Promise<void> {
  await db.contacts.delete(id);
}

/** Her preferences with defaults filled in, in the current shape even if an older version wrote them. */
export async function getPreferences(): Promise<Preferences> {
  return migratePreferences(await db.preferences.get("me"));
}
export async function savePreferences(prefs: Preferences): Promise<void> {
  await db.preferences.put({ ...prefs, id: "me" });
}
