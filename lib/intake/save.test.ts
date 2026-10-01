import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../db";
import { DEFAULT_PREFERENCES, DEFAULT_PROFILE } from "../defaults";
import { MASTER } from "../resume/engine/__fixtures__/master";
import type { JobSignals } from "../scoring/signals";
import { assessJob, looksLikeJobPosting, looksLikeUrl, type JobAnalysis } from "./analyze";
import { saveAnalyzedJob } from "./save";

const signals: JobSignals = {
  company: "Stripe",
  role: "Software Engineer, New Grad",
  location: "Remote (US)",
  workMode: "Remote",
  salary: "$150k",
  seniority: "New grad",
  mustHaveSkills: ["React", "TypeScript", "Postgres"],
  niceToHaveSkills: [],
  visaSignal: "sponsors",
  visaEvidence: "We sponsor visas",
  citizenshipRequired: false,
  clearanceRequired: false,
  freshness: "within_24h",
  freshnessEvidence: "",
  optSignal: "welcomes-opt",
  optEvidence: "OPT welcome",
  minYearsExperience: 0,
  degreeRequired: "bachelors",
};

function analysis(url = "https://stripe.com/jobs/1"): JobAnalysis {
  return { url, jdText: "Build things with React.", signals, ...assessJob(signals, DEFAULT_PREFERENCES, MASTER) };
}

beforeEach(async () => {
  await db.applications.clear();
});

describe("assessJob", () => {
  it("checks required skills against the master profile and clears a job that meets every must-have", () => {
    const a = analysis();
    expect(a.requiredSkills).toEqual({ have: ["React", "TypeScript", "Postgres"], gap: [] });
    expect(a.skills?.percent).toBe(100);
    expect(a.decision.canApply).toBe(true);
  });

  it("rules a job out when it fails a must-have she has turned on, and not when it's off", () => {
    const masters = { ...signals, degreeRequired: "masters" as const };
    const profile = { ...DEFAULT_PROFILE, degreeType: "Bachelor's degree" };
    expect(assessJob(masters, DEFAULT_PREFERENCES, MASTER, "", { profile }).decision.failed.map((f) => f.key)).toEqual(["degree"]);
    const off = { ...DEFAULT_PREFERENCES, mustHaves: { ...DEFAULT_PREFERENCES.mustHaves, degree: false } };
    expect(assessJob(masters, off, MASTER, "", { profile }).decision.canApply).toBe(true);
    // Without a degree in her Profile, a master's requirement is unclear, not a fail.
    expect(assessJob(masters, DEFAULT_PREFERENCES, MASTER).decision.unclear.map((f) => f.key)).toContain("degree");
  });

  it("counts preferred skills in the percentage", () => {
    const a = assessJob({ ...signals, niceToHaveSkills: ["Haskell"] }, DEFAULT_PREFERENCES, MASTER);
    expect(a.skills?.preferred.gap).toEqual(["Haskell"]);
    expect(a.skills?.percent).toBe(75);
  });

  it("falls back to the technologies the text mentions when the posting lists no skills", () => {
    const none = { ...signals, mustHaveSkills: [], niceToHaveSkills: [] };
    const jd = "We build web apps with React, TypeScript and PostgreSQL, deployed with Kubernetes and Terraform.";
    const a = assessJob(none, DEFAULT_PREFERENCES, MASTER, jd);
    expect(a.skills?.basis).toBe("mentioned");
    expect(a.skills?.required.have).toEqual(expect.arrayContaining(["React", "TypeScript", "PostgreSQL"]));
    expect(a.skills?.required.gap).toEqual(expect.arrayContaining(["Kubernetes", "Terraform"]));
    expect(assessJob(none, DEFAULT_PREFERENCES, MASTER, "A great team and a friendly office.").skills?.percent).toBeNull();
  });

  it("skips the skills check without a master profile", () => {
    const a = assessJob(signals, DEFAULT_PREFERENCES, "");
    expect(a.requiredSkills).toBeNull();
    expect(a.skills).toBeNull();
  });
});

describe("saveAnalyzedJob", () => {
  it("adds the job to the tracker as Saved, with score and checklist", async () => {
    const app = await saveAnalyzedJob(analysis());
    const stored = await db.applications.get(app.id);
    expect(stored).toMatchObject({ company: "Stripe", stage: "Saved", url: "https://stripe.com/jobs/1", visa: "sponsors" });
    const breakdown = JSON.parse(stored!.fitBreakdown!);
    expect(breakdown.criteria).toHaveLength(7);
    expect(breakdown.skills.percent).toBe(100);
    expect(breakdown.decision.canApply).toBe(true);
    // The extracted signals are kept, so the job can be re-assessed later with no AI call.
    expect(breakdown.signals).toMatchObject({ company: "Stripe", degreeRequired: "bachelors" });
  });

  it("updates the same link instead of duplicating, keeping her own edits", async () => {
    const first = await saveAnalyzedJob(analysis());
    await db.applications.update(first.id, { company: "Stripe (Payments)", notes: "Referral from Sam" });
    const second = await saveAnalyzedJob(analysis());
    expect(second.id).toBe(first.id);
    expect(await db.applications.count()).toBe(1);
    expect(await db.applications.get(first.id)).toMatchObject({ company: "Stripe (Payments)", notes: "Referral from Sam" });
  });

  it("treats a pasted job with the same company and role as the same position", async () => {
    await saveAnalyzedJob(analysis(""));
    await saveAnalyzedJob(analysis(""));
    expect(await db.applications.count()).toBe(1);
    await saveAnalyzedJob({ ...analysis(""), signals: { ...signals, role: "Data Engineer" } });
    expect(await db.applications.count()).toBe(2);
  });

  it("keeps two different links with the same title apart", async () => {
    await saveAnalyzedJob(analysis("https://stripe.com/jobs/10"));
    await saveAnalyzedJob(analysis("https://stripe.com/jobs/11"));
    expect(await db.applications.count()).toBe(2);
  });

  it("re-checks a specific job in place even when it has no link (or the link was edited)", async () => {
    const first = await saveAnalyzedJob(analysis(""));
    await db.applications.update(first.id, { notes: "Mine", jdText: "shell" });
    const again = await saveAnalyzedJob(analysis(""), first.id);
    expect(again.id).toBe(first.id);
    expect(await db.applications.count()).toBe(1);
    expect(await db.applications.get(first.id)).toMatchObject({ notes: "Mine", jdText: "Build things with React." });
    const edited = await saveAnalyzedJob(analysis("https://stripe.com/jobs/other"), first.id);
    expect(edited.id).toBe(first.id);
    expect(await db.applications.count()).toBe(1);
  });
});

describe("looksLikeUrl", () => {
  it("accepts http(s) links only", () => {
    expect(looksLikeUrl(" https://jobs.lever.co/x/1 ")).toBe(true);
    expect(looksLikeUrl("jobs.lever.co/x")).toBe(false);
    expect(looksLikeUrl("We are hiring")).toBe(false);
  });
});

describe("looksLikeJobPosting", () => {
  const filler = (n: number) => Array(n).fill("word").join(" ");
  it("accepts a real job description", () => {
    const jd = `About the role. You will build features. Responsibilities: ship code. Qualifications: a bachelor's degree and experience with React. ${filler(120)}`;
    expect(looksLikeJobPosting(jd)).toBe(true);
  });
  it("rejects a page shell: navigation, cookie banner, or too little text", () => {
    expect(looksLikeJobPosting(`Careers Home Search Jobs Sign in Cookie preferences Accept all Privacy Policy ${filler(300)}`)).toBe(false);
    expect(looksLikeJobPosting("Responsibilities. Qualifications. Skills.")).toBe(false);
  });
});

describe("saveAnalyzedJob and repeat checks", () => {
  it("keeps a new job out of the table (Checked jobs) and recognizes the same position later", async () => {
    const first = await saveAnalyzedJob(analysis("https://stripe.com/jobs/1"));
    expect(first.triage).toBe("checked");
    expect(first.checkedBefore).toBeUndefined();
    // Same position, pasted with no link: matched by company and role, not duplicated.
    const again = await saveAnalyzedJob({ ...analysis(""), url: "" });
    expect(again.id).toBe(first.id);
    expect(again.checkedBefore).toBeGreaterThan(0);
    expect(await db.applications.count()).toBe(1);
  });

  it("doesn't pull a job she already tracks or skipped back into Checked", async () => {
    const first = await saveAnalyzedJob(analysis("https://stripe.com/jobs/2"));
    await db.applications.update(first.id, { triage: undefined });
    expect((await saveAnalyzedJob(analysis("https://stripe.com/jobs/2?utm_source=x"))).triage).toBeUndefined();
    await db.applications.update(first.id, { triage: "skipped" });
    expect((await saveAnalyzedJob(analysis("https://stripe.com/jobs/2"))).triage).toBe("skipped");
  });
});
