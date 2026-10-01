import { beforeEach, describe, expect, it } from "vitest";
import { base64ToBytes, buildBackup, bytesToBase64, exportBackup, parseBackup, restoreBackup } from "./backup";
import { db, getMasterProfile, getPreferences, getProfile, getSettings, saveMasterProfile, savePreferences, saveProfile, saveSettings } from "./db";
import { DEFAULT_PREFERENCES, DEFAULT_PROFILE, DEFAULT_SETTINGS } from "./defaults";
import { blankApplication } from "./tracker/blank";
import type { Preferences } from "./types";

const settings = {
  ...DEFAULT_SETTINGS,
  anthropicKey: "sk-ant-secret",
  jsearchApiKey: "rapidapi-secret",
  workspaceId: "wrkspc_1",
  smartModel: "claude-opus-5",
};
const profile = { ...DEFAULT_PROFILE, fullName: "Sam Rivera", major: "Computer Science", requiresSponsorship: "no" as const };
const prefs: Preferences = { ...DEFAULT_PREFERENCES, experienceLevel: "early", locations: ["metro:austin", "remote-us"] };

async function clearAll() {
  await Promise.all(db.tables.map((t) => t.clear()));
}

beforeEach(clearAll);

describe("backup file", () => {
  it("leaves both API keys out by default", () => {
    const text = buildBackup(settings, profile, prefs, { includeKey: false });
    expect(text).not.toContain("sk-ant-secret");
    expect(text).not.toContain("rapidapi-secret");
    expect(parseBackup(text).includesKey).toBe(false);
  });

  it("includes both keys only when asked", () => {
    const parsed = parseBackup(buildBackup(settings, profile, prefs, { includeKey: true }));
    expect(parsed.settings.anthropicKey).toBe("sk-ant-secret");
    expect(parsed.settings.jsearchApiKey).toBe("rapidapi-secret");
    expect(parsed.includesKey).toBe(true);
  });

  it("round-trips profile, preferences and model choices", () => {
    const parsed = parseBackup(buildBackup(settings, profile, prefs, { includeKey: false }));
    expect(parsed.profile.fullName).toBe("Sam Rivera");
    expect(parsed.preferences.locations).toEqual(["metro:austin", "remote-us"]);
    expect(parsed.preferences.experienceLevel).toBe("early");
    expect(parsed.settings).toMatchObject({ workspaceId: "wrkspc_1", smartModel: "claude-opus-5" });
  });

  it("round-trips the master profile, and leaves it undefined in older backups", () => {
    const parsed = parseBackup(buildBackup(settings, profile, prefs, { includeKey: false, masterProfile: "## Experience\n- Built X" }));
    expect(parsed.masterProfile).toBe("## Experience\n- Built X");
    expect(parseBackup(buildBackup(settings, profile, prefs, { includeKey: false })).masterProfile).toBeUndefined();
  });

  it("fills fields missing from an older backup with defaults", () => {
    const text = JSON.stringify({
      app: "job-application-copilot",
      version: 1,
      exportedAt: "2026-01-01T00:00:00Z",
      settings: {},
      profile: { fullName: "Old Backup" },
      preferences: { applyThreshold: 80 },
    });
    const parsed = parseBackup(text);
    expect(parsed.version).toBe(1);
    expect(parsed.tables).toBeUndefined();
    expect(parsed.profile.fullName).toBe("Old Backup");
    expect(parsed.profile.email).toBe("");
    expect(parsed.preferences.applyThreshold).toBe(80);
    expect(parsed.preferences.weights).toEqual(DEFAULT_PREFERENCES.weights);
  });

  it("normalizes an old-format backup's preferences with the same migration as the database", () => {
    const text = JSON.stringify({
      app: "job-application-copilot",
      version: 1,
      exportedAt: "2026-09-20T00:00:00Z",
      settings: {},
      profile: {},
      preferences: {
        targetRoles: ["SWE", "AI Engineer", "Product", "UX/UI"],
        workModes: ["Remote", "Hybrid"],
        regions: ["Orange County, CA", "Los Angeles, CA"],
        mustHaves: { newGrad: true, bachelorsEnough: true, location: true, internationalOk: true, opt: true },
      },
    });
    const p = parseBackup(text).preferences;
    expect(p.locations).toEqual(["metro:oc", "metro:la", "remote-us"]);
    expect(p.mustHaves).toEqual({ experience: true, degree: true, location: true, workAuth: true, clearance: true });
    expect(p.experienceLevel).toBe("new-grad");
    expect(p.targetRoles).toEqual(["Software Engineering", "AI / ML", "Product Management", "Design (UX/UI)"]);
    expect(p).not.toHaveProperty("regions");
  });

  it("rejects files that are not backups", () => {
    expect(() => parseBackup("not json")).toThrow(/not JSON/);
    expect(() => parseBackup(JSON.stringify({ hello: "world" }))).toThrow(/not a backup/);
  });

  it("encodes bytes as base64 and back", () => {
    const bytes = new Uint8Array([0, 1, 2, 250, 255, 80, 75]).buffer;
    expect(new Uint8Array(base64ToBytes(bytesToBase64(bytes)))).toEqual(new Uint8Array(bytes));
    const big = new Uint8Array(100_000).map((_, i) => i % 256).buffer;
    expect(new Uint8Array(base64ToBytes(bytesToBase64(big)))).toEqual(new Uint8Array(big));
  });
});

describe("exportBackup + restoreBackup (the whole database)", () => {
  const docxBytes = new Uint8Array([0x50, 0x4b, 3, 4, 20, 0, 6, 0, 8, 0, 255, 128]).buffer;
  const pdfBytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 1, 2, 3]).buffer;

  async function seed() {
    await saveSettings({ anthropicKey: "sk-ant-secret", smartModel: "claude-opus-5", workspaceId: "wrkspc_1" });
    await saveProfile(profile);
    await savePreferences(prefs);
    await saveMasterProfile("### Experience\n**Engineer | Acme | Austin, TX | Jan 2024 - Present**\n- Built things");
    await db.answerBank.add({ question: "Why us?", answer: "Because.", tags: ["general"] });
    const appId = await db.applications.add({
      ...blankApplication(1),
      company: "Acme",
      role: "Data Analyst",
      roleType: "Data & Analytics",
      triage: "checked",
      fitScore: 72,
      fitBreakdown: JSON.stringify({ score: 72, decision: { canApply: true, filters: [], failed: [], unclear: [] } }),
    });
    const skippedId = await db.applications.add({ ...blankApplication(2), company: "Beta", role: "SWE", triage: "skipped" });
    const tailoredId = await db.tailoredResumes.add({
      applicationId: appId,
      format: "docx",
      bytes: docxBytes,
      keywordScoreBefore: 40,
      keywordScoreAfter: 80,
      appliedEdits: '{"v":2}',
      createdAt: 5,
    });
    await db.applications.update(appId, { tailoredResumeId: tailoredId });
    await db.contacts.add({ applicationId: appId, name: "Jo", role: "Recruiter", linkedinUrl: "", type: "recruiter", status: "sent", draft: "Hi" });
    await db.baseResumes.add({ label: "Software Engineering", fileName: "base.pdf", format: "pdf", bytes: pdfBytes, addedAt: 3, structure: "{}" });
    await db.feed.add({
      source: "jsearch",
      externalId: "x1",
      url: "",
      company: "Gamma",
      title: "SWE",
      location: "",
      workMode: "Unknown",
      visa: "unknown",
      jdText: "",
      firstSeen: 1,
      state: "new",
    });
    return { appId, skippedId, tailoredId };
  }

  it("carries every table, keeps ids and links, and leaves the key out by default", async () => {
    const { appId, skippedId, tailoredId } = await seed();
    const text = await exportBackup({ includeKey: false });
    expect(text).not.toContain("sk-ant-secret");

    await clearAll();
    await saveSettings({ anthropicKey: "sk-ant-already-here" });
    const summary = await restoreBackup(text);
    expect(summary).toMatchObject({ applications: 2, tailoredResumes: 1, contacts: 1, answerBank: 1, baseResumes: 1, fullBackup: true });

    // Settings: models restored, and the key already in this browser is kept (not wiped).
    expect(await getSettings()).toMatchObject({ smartModel: "claude-opus-5", workspaceId: "wrkspc_1", anthropicKey: "sk-ant-already-here" });
    expect((await getProfile()).fullName).toBe("Sam Rivera");
    expect((await getPreferences()).locations).toEqual(["metro:austin", "remote-us"]);
    expect(await getMasterProfile()).toContain("Engineer | Acme");
    expect(await db.answerBank.toArray()).toMatchObject([{ question: "Why us?" }]);

    const app = await db.applications.get(appId);
    expect(app).toMatchObject({ company: "Acme", triage: "checked", fitScore: 72, tailoredResumeId: tailoredId, roleType: "Data & Analytics" });
    expect(JSON.parse(app!.fitBreakdown!).score).toBe(72);
    expect((await db.applications.get(skippedId))?.triage).toBe("skipped");

    const tailored = await db.tailoredResumes.get(tailoredId);
    expect(tailored?.applicationId).toBe(appId);
    expect(new Uint8Array(tailored!.bytes)).toEqual(new Uint8Array(docxBytes));
    expect((await db.contacts.toArray())[0]).toMatchObject({ applicationId: appId, name: "Jo", status: "sent" });
    const [base] = await db.baseResumes.toArray();
    expect(new Uint8Array(base.bytes)).toEqual(new Uint8Array(pdfBytes));
    expect(await db.feed.count()).toBe(1);
  });

  it("includes the key only when asked", async () => {
    await seed();
    const text = await exportBackup({ includeKey: true });
    await clearAll();
    await restoreBackup(text);
    expect((await getSettings()).anthropicKey).toBe("sk-ant-secret");
  });

  it("replaces the tables instead of mixing two databases", async () => {
    await seed();
    const text = await exportBackup({ includeKey: false });
    await db.applications.add({ ...blankApplication(9), company: "Only here" });
    await restoreBackup(text);
    expect((await db.applications.toArray()).map((a) => a.company).sort()).toEqual(["Acme", "Beta"]);
  });

  it("restores an old settings-only backup without touching the tables", async () => {
    await seed();
    const old = JSON.stringify({
      app: "job-application-copilot",
      version: 1,
      exportedAt: "2026-09-01T00:00:00Z",
      settings: { smartModel: "claude-sonnet-5" },
      profile: { fullName: "From v1" },
      preferences: { regions: ["Seattle, WA"], workModes: ["Hybrid"], mustHaves: { newGrad: false } },
    });
    const summary = await restoreBackup(old);
    expect(summary.fullBackup).toBe(false);
    expect((await getProfile()).fullName).toBe("From v1");
    const p = await getPreferences();
    expect(p.locations).toEqual(["metro:seattle"]);
    expect(p.mustHaves.experience).toBe(false);
    expect(await db.applications.count()).toBe(2);
  });

  it("remaps old role types found in a backup", async () => {
    const text = buildBackup(settings, profile, prefs, {
      includeKey: false,
      tables: {
        answerBank: [],
        applications: [{ ...blankApplication(1), company: "Old", role: "Product Manager", roleType: "Product" as never }],
        tailoredResumes: [],
        contacts: [],
        baseResumes: [],
        feed: [],
      },
    });
    await restoreBackup(text);
    expect((await db.applications.toArray())[0].roleType).toBe("Product Management");
  });
});
