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

describe("Dexie v4 upgrade", () => {
  it("migrates her v3 preferences, role types and base resume labels", async () => {
    await writeV3();
    await db.open();
    expect(db.verno).toBe(4);

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
