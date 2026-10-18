import Dexie from "dexie";
import { describe, expect, it } from "vitest";
import { db, getPreferences } from "./db";

// Opens a real (fake-indexeddb) database written by the v3 schema, then lets the app's Dexie
// instance open it: the v4 upgrade must turn her old preferences and role types into the new ones.

const NAME = "job-application-copilot";

async function writeV3() {
  db.close();
  await Dexie.delete(NAME);
  const old = new Dexie(NAME);
  old.version(3).stores({
    settings: "id",
    profile: "id",
    preferences: "id",
    answerBank: "++id, *tags",
    baseResumes: "++id, label",
    applications: "++id, stage, company, fitScore, appliedDate, createdAt",
    feed: "++id, state, fitScore, [source+externalId], firstSeen",
    tailoredResumes: "++id, applicationId",
    contacts: "++id, applicationId, status",
    docs: "id",
  });
  await old.open();
  await old.table("preferences").put({
    id: "me",
    targetRoles: ["SWE", "AI Engineer", "Product", "UX/UI"],
    keywords: [],
    seniority: ["New grad", "Entry level"],
    workModes: ["Remote", "Hybrid"],
    regions: ["Orange County, CA", "Los Angeles, CA", "San Diego, CA"],
    companyWatchlist: ["Amazon", "Apple"],
    mustHaves: { newGrad: true, bachelorsEnough: true, location: true, internationalOk: true, opt: true },
    dealBreakers: { noSponsorship: true, citizenshipRequired: true, clearanceRequired: true, locationOutsideTargets: true },
    weights: { sponsorship: 30, location: 25, match: 25, other: 10, freshness: 10 },
    applyThreshold: 75,
  });
  const app = (company: string, role: string, roleType: string) => ({
    company,
    role,
    roleType,
    stage: "Saved",
    url: "",
    location: "",
    workMode: "Unknown",
    appliedDate: "",
    respondDate: "",
    referral: "",
    tailoredUrl: "",
    contactName: "",
    contactLinkedin: "",
    salary: "",
    source: "",
    visa: "unknown",
    followUpDate: "",
    notes: "",
    jdText: "",
    createdAt: 1,
    updatedAt: 1,
  });
  await old.table("applications").bulkAdd([
    app("A", "Software Engineer", "SWE"),
    app("B", "ML Engineer", "AI Engineer"),
    app("C", "APM", "Product"),
    app("D", "Designer", "UX/UI"),
    app("E", "Recruiter", "Other"),
  ]);
  await old.table("baseResumes").add({ label: "SWE", fileName: "r.pdf", format: "pdf", bytes: new ArrayBuffer(1), addedAt: 1 });
  old.close();
}

/** A v4 database with realistic rows in every table, as the live site has before the v5 upgrade. */
async function writeV4() {
  db.close();
  await Dexie.delete(NAME);
  const old = new Dexie(NAME);
  old.version(4).stores({
    settings: "id",
    profile: "id",
    preferences: "id",
    answerBank: "++id, *tags",
    baseResumes: "++id, label",
    applications: "++id, stage, company, fitScore, appliedDate, createdAt",
    feed: "++id, state, fitScore, [source+externalId], firstSeen",
    tailoredResumes: "++id, applicationId",
    contacts: "++id, applicationId, status",
    docs: "id",
  });
  await old.open();
  await old.table("settings").put({ id: "app", provider: "anthropic", anthropicKey: "test-anthropic-key", workspaceId: "", fastModel: "claude-haiku-4-5", smartModel: "claude-sonnet-5", jsearchApiKey: "" });
  await old.table("profile").put({ id: "me", fullName: "Alex Rivera", email: "alex@example.com", school: "Lakeside University" });
  await old.table("docs").put({ id: "masterProfile", text: "## Experience\nBrightloop | Software Engineer Intern\n- Built a dashboard", updatedAt: 5 });
  const ids = await old.table("applications").bulkAdd(
    [
      { company: "Taskwise", role: "Software Engineer", stage: "Applied", appliedDate: "2026-09-01", fitScore: 82, fitBreakdown: "{}", triage: undefined, createdAt: 1, updatedAt: 2 },
      { company: "DemoDeck", role: "Frontend Engineer", stage: "Saved", triage: "checked", fitScore: 64, createdAt: 3, updatedAt: 3 },
    ],
    { allKeys: true },
  );
  await old.table("tailoredResumes").add({ applicationId: ids[0], fileName: "Alex_Rivera_Taskwise.docx", bytes: new ArrayBuffer(4), createdAt: 4 });
  await old.table("contacts").add({ applicationId: ids[0], name: "Jordan Lee", status: "sent" });
  await old.table("answerBank").add({ question: "Why us?", answer: "Because.", tags: ["why"] });
  old.close();
}

describe("Dexie v5 upgrade", () => {
  it("adds the AI usage table and leaves every existing row as it was", async () => {
    await writeV4();
    await db.open();
    expect(db.verno).toBe(5);
    expect(await db.aiUsage.count()).toBe(0);
    expect((await db.settings.get("app"))?.anthropicKey).toBe("test-anthropic-key");
    expect((await db.profile.get("me"))?.fullName).toBe("Alex Rivera");
    expect((await db.docs.get("masterProfile"))?.text).toContain("Brightloop");
    const apps = await db.applications.orderBy("company").toArray();
    expect(apps.map((a) => [a.company, a.stage, a.triage])).toEqual([
      ["DemoDeck", "Saved", "checked"],
      ["Taskwise", "Applied", undefined],
    ]);
    expect(await db.tailoredResumes.count()).toBe(1);
    expect(await db.contacts.count()).toBe(1);
    expect(await db.answerBank.count()).toBe(1);
    // The new table works.
    await db.aiUsage.add({ at: 10, provider: "openai", model: "m", task: "write_resume", inputTokens: 1, outputTokens: 2, cacheReadTokens: 0, cacheWriteTokens: 0 });
    expect(await db.aiUsage.where("at").aboveOrEqual(5).count()).toBe(1);
  });
});

describe("Dexie v4 upgrade", () => {
  it("migrates her v3 preferences, role types and base resume labels", async () => {
    await writeV3();
    await db.open();
    expect(db.verno).toBeGreaterThanOrEqual(4);

    const p = await getPreferences();
    expect(p.locations).toEqual(["metro:oc", "metro:la", "metro:san-diego", "remote-us"]);
    expect(p.experienceLevel).toBe("new-grad");
    expect(p.mustHaves).toEqual({ experience: true, degree: true, location: true, workAuth: true, clearance: true });
    expect(p.targetRoles).toEqual(["Software Engineering", "AI / ML", "Product Management", "Design (UX/UI)"]);
    expect(p.workModes).toEqual(["Remote", "Hybrid"]);
    // What's stored is the new shape, not only what getPreferences returns.
    const stored = await db.preferences.get("me");
    expect(stored).not.toHaveProperty("regions");
    expect(stored?.mustHaves).not.toHaveProperty("newGrad");

    const roles = (await db.applications.orderBy("company").toArray()).map((a) => a.roleType);
    expect(roles).toEqual(["Software Engineering", "AI / ML", "Product Management", "Design (UX/UI)", "Other"]);
    expect((await db.baseResumes.toArray())[0].label).toBe("Software Engineering");
  });
});
