import Dexie, { type Table } from "dexie";
import { DEFAULT_PROFILE, DEFAULT_SETTINGS } from "./defaults";
import { migratePreferences } from "./eligibility/migrate";
import { migrateRoleType } from "./eligibility/roles";
import type {
  AnswerBankEntry,
  AppSettings,
  Application,
  BaseResume,
  Contact,
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

export async function getMasterProfile(): Promise<string> {
  return (await db.docs.get("masterProfile"))?.text ?? "";
}
export async function saveMasterProfile(text: string): Promise<void> {
  await db.docs.put({ id: "masterProfile", text, updatedAt: Date.now() });
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
