import { z } from "zod";
import { db, getMasterProfile, getPreferences, getProfile, getSettings, saveMasterProfile, savePreferences, saveProfile, saveSettings } from "./db";
import { DEFAULT_PROFILE } from "./defaults";
import { migratePreferences } from "./eligibility/migrate";
import { migrateRoleType } from "./eligibility/roles";
import type { AnswerBankEntry, AppSettings, Application, BaseResume, Contact, FeedItem, Preferences, Profile, TailoredResume } from "./types";

// A backup file carries EVERYTHING in this browser's database, so moving to another browser (or
// from localhost to the deployed site) loses nothing: settings (API keys only if she opts in),
// Profile, Preferences, her experience (master profile), answer bank, applications with their
// saved analyses, tailored resumes (file bytes as base64), contacts, base resumes and the feed.
// The resume folder isn't included: the browser only lets you re-pick it.
//
// Version 1 files (settings, profile, preferences, master profile only) still restore; their
// preferences go through the same migration as the database (lib/eligibility/migrate.ts).

export const BACKUP_VERSION = 2;

const SettingsSchema = z.object({
  workspaceId: z.string().optional(),
  fastModel: z.string().optional(),
  smartModel: z.string().optional(),
  anthropicKey: z.string().optional(),
  jsearchApiKey: z.string().optional(),
});

const Rows = z.array(z.record(z.unknown()));

const BackupSchema = z.object({
  app: z.literal("job-application-copilot"),
  version: z.union([z.literal(1), z.literal(2)]),
  exportedAt: z.string(),
  settings: SettingsSchema,
  profile: z.record(z.unknown()),
  preferences: z.record(z.unknown()),
  masterProfile: z.string().optional(),
  tables: z
    .object({
      answerBank: Rows.optional(),
      applications: Rows.optional(),
      tailoredResumes: Rows.optional(),
      contacts: Rows.optional(),
      baseResumes: Rows.optional(),
      feed: Rows.optional(),
    })
    .optional(),
});

/** Every table besides the singleton records. */
export interface BackupTables {
  answerBank: AnswerBankEntry[];
  applications: Application[];
  tailoredResumes: TailoredResume[];
  contacts: Contact[];
  baseResumes: BaseResume[];
  feed: FeedItem[];
}

export interface ParsedBackup {
  version: 1 | 2;
  settings: Partial<Pick<AppSettings, "workspaceId" | "fastModel" | "smartModel" | "anthropicKey" | "jsearchApiKey">>;
  profile: Profile;
  preferences: Preferences;
  /** Absent in backups made before the master profile existed. */
  masterProfile?: string;
  /** Absent in version 1 backups, which held settings only. */
  tables?: BackupTables;
  includesKey: boolean;
}

// ---- bytes <-> base64 (browser and Node both have btoa/atob) ----

export function bytesToBase64(bytes: ArrayBuffer): string {
  const view = new Uint8Array(bytes);
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < view.length; i += CHUNK) binary += String.fromCharCode(...view.subarray(i, i + CHUNK));
  return btoa(binary);
}

export function base64ToBytes(b64: string): ArrayBuffer {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out.buffer;
}

const encodeFile = <T extends { bytes: ArrayBuffer }>(row: T) => ({ ...row, bytes: bytesToBase64(row.bytes) });
function decodeFile<T extends { bytes: ArrayBuffer }>(row: Record<string, unknown>): T {
  return { ...row, bytes: typeof row.bytes === "string" ? base64ToBytes(row.bytes) : new ArrayBuffer(0) } as unknown as T;
}

// ---- building ----

export function buildBackup(
  settings: AppSettings,
  profile: Profile,
  preferences: Preferences,
  opts: { includeKey: boolean; now?: Date; masterProfile?: string; tables?: BackupTables },
): string {
  const t = opts.tables;
  const backup = {
    app: "job-application-copilot",
    version: BACKUP_VERSION,
    exportedAt: (opts.now ?? new Date()).toISOString(),
    settings: {
      workspaceId: settings.workspaceId,
      fastModel: settings.fastModel,
      smartModel: settings.smartModel,
      ...(opts.includeKey ? { anthropicKey: settings.anthropicKey, jsearchApiKey: settings.jsearchApiKey } : {}),
    },
    profile,
    preferences,
    ...(opts.masterProfile ? { masterProfile: opts.masterProfile } : {}),
    ...(t
      ? {
          tables: {
            answerBank: t.answerBank,
            applications: t.applications,
            tailoredResumes: t.tailoredResumes.map(encodeFile),
            contacts: t.contacts,
            baseResumes: t.baseResumes.map(encodeFile),
            feed: t.feed,
          },
        }
      : {}),
  };
  return JSON.stringify(backup, null, 2);
}

/** Reads the whole database into a backup file's text. API keys only when `includeKey`. */
export async function exportBackup(opts: { includeKey: boolean; now?: Date }): Promise<string> {
  const [settings, profile, preferences, masterProfile, answerBank, applications, tailoredResumes, contacts, baseResumes, feed] = await Promise.all([
    getSettings(),
    getProfile(),
    getPreferences(),
    getMasterProfile(),
    db.answerBank.toArray(),
    db.applications.toArray(),
    db.tailoredResumes.toArray(),
    db.contacts.toArray(),
    db.baseResumes.toArray(),
    db.feed.toArray(),
  ]);
  return buildBackup(settings, profile, preferences, {
    ...opts,
    masterProfile,
    tables: { answerBank, applications, tailoredResumes, contacts, baseResumes, feed },
  });
}

// ---- reading ----

/** Parse and validate a backup file. Throws an Error with a plain message if it is not one of ours. */
export function parseBackup(text: string): ParsedBackup {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error("That file is not a valid backup (it is not JSON).");
  }
  const parsed = BackupSchema.safeParse(raw);
  if (!parsed.success) throw new Error("That file is not a backup from this app.");
  const b = parsed.data;
  const t = b.tables;
  return {
    version: b.version,
    settings: b.settings,
    // Fill any missing fields from defaults so an older or partial backup still loads.
    profile: { ...DEFAULT_PROFILE, ...(b.profile as Partial<Profile>), id: "me" },
    // Old-format preferences (regions, the one-persona must-haves) become the current shape.
    preferences: migratePreferences(b.preferences),
    masterProfile: b.masterProfile,
    tables: t
      ? {
          answerBank: (t.answerBank ?? []) as unknown as AnswerBankEntry[],
          applications: (t.applications ?? []).map(
            (a) => ({ ...a, roleType: migrateRoleType(a.roleType as string | undefined, (a.role as string) ?? "") }) as unknown as Application,
          ),
          tailoredResumes: (t.tailoredResumes ?? []).map((r) => decodeFile<TailoredResume>(r)),
          contacts: (t.contacts ?? []) as unknown as Contact[],
          baseResumes: (t.baseResumes ?? []).map((r) => decodeFile<BaseResume>(r)),
          feed: (t.feed ?? []) as unknown as FeedItem[],
        }
      : undefined,
    includesKey:
      (typeof b.settings.anthropicKey === "string" && b.settings.anthropicKey !== "") ||
      (typeof b.settings.jsearchApiKey === "string" && b.settings.jsearchApiKey !== ""),
  };
}

export interface RestoreSummary {
  applications: number;
  tailoredResumes: number;
  contacts: number;
  answerBank: number;
  baseResumes: number;
  /** False for a version 1 file: only settings, Profile, Preferences and experience were in it. */
  fullBackup: boolean;
}

/**
 * Writes a backup into this browser's database, in one transaction (all or nothing). The
 * singleton records are replaced (settings are merged, so a key left out of the file keeps the
 * one already here). A full (version 2) backup replaces every table, keeping row ids so tailored
 * resumes and contacts stay linked to their jobs. A version 1 file leaves the tables alone.
 */
export async function restoreBackup(input: string | ParsedBackup): Promise<RestoreSummary> {
  const b = typeof input === "string" ? parseBackup(input) : input;
  const t = b.tables;
  await db.transaction(
    "rw",
    [db.settings, db.profile, db.preferences, db.docs, db.answerBank, db.applications, db.tailoredResumes, db.contacts, db.baseResumes, db.feed],
    async () => {
      await saveSettings(b.settings);
      await saveProfile(b.profile);
      await savePreferences(b.preferences);
      if (b.masterProfile !== undefined) await saveMasterProfile(b.masterProfile);
      if (!t) return;
      await Promise.all([db.answerBank.clear(), db.applications.clear(), db.tailoredResumes.clear(), db.contacts.clear(), db.baseResumes.clear(), db.feed.clear()]);
      await db.answerBank.bulkPut(t.answerBank);
      await db.applications.bulkPut(t.applications);
      await db.tailoredResumes.bulkPut(t.tailoredResumes);
      await db.contacts.bulkPut(t.contacts);
      await db.baseResumes.bulkPut(t.baseResumes);
      await db.feed.bulkPut(t.feed);
    },
  );
  return {
    applications: t?.applications.length ?? 0,
    tailoredResumes: t?.tailoredResumes.length ?? 0,
    contacts: t?.contacts.length ?? 0,
    answerBank: t?.answerBank.length ?? 0,
    baseResumes: t?.baseResumes.length ?? 0,
    fullBackup: !!t,
  };
}
