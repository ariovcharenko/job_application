import { describe, expect, it } from "vitest";
import { skillHits } from "../resume/coverage";
import { focusRelevance } from "../resume/engine/focus";
import type { ResumeDoc } from "../resume/engine/schema";
import { explainTailoring } from "../resume/engine/tailored";
import { fitResume, type ResumeFitResult } from "../resume/engine/trim";
import { applyApprovals, validateResume } from "../resume/engine/validate";
import { wrapBullet } from "../resume/quality/measure";
import { DEMO_EXPERIENCE, DEMO_JOBS } from "./data";
import { demoFocus, demoPool } from "./seed";

// The measurable check that tailoring is about the job: the same demo experience, tailored by code
// alone (no AI call) for very different demo jobs, gives visibly different pages. The page is a
// node-side stand-in for the browser measure (fit.ts): bullets wrap by Times New Roman widths
// (lib/resume/quality/measure.ts), on a page a bit smaller than the demo's whole experience, so
// every job has to choose what to leave off.

const CAPACITY = 42;
function page(d: ResumeDoc): number {
  const sec = (k: number) => (k ? 1.5 : 0);
  const bullets = (bs: string[]) => bs.reduce((t, b) => t + wrapBullet(b).lines.length, 0);
  const p = d.projects ?? [];
  const n =
    3 +
    sec(d.education.length) + d.education.reduce((s, e) => s + 2 + bullets(e.bullets), 0) +
    sec(d.experience.length) + d.experience.reduce((s, e) => s + 2 + bullets(e.bullets), 0) +
    sec(p.length) + p.reduce((s, e) => s + 1 + bullets(e.bullets), 0) +
    sec(d.skills.length) + d.skills.length +
    sec(d.leadership.length) + d.leadership.length;
  const l = d.layout ?? { body: 10, spacing: 1 };
  return (n * (l.body / 10) * l.spacing) / CAPACITY;
}

const jobs = DEMO_JOBS.filter((j) => j.resume);
const skillsOf = (j: (typeof jobs)[number]) => [...j.signals.mustHaveSkills, ...j.signals.niceToHaveSkills];

/** Tailored with the job focus (now). */
function tailor(company: string) {
  const job = jobs.find((j) => j.signals.company === company)!;
  const focus = demoFocus(job);
  const checked = validateResume(demoPool(DEMO_EXPERIENCE, skillsOf(job), focus), DEMO_EXPERIENCE, { jobSkills: skillsOf(job), focus });
  const fit = fitResume(applyApprovals(checked.doc, checked.flags, new Set()), page, { focus });
  return { focus, checked, fit, summary: explainTailoring(focus, fit) };
}

/** Tailored the old way: only a count of the job's skills in each bullet. */
function tailorBySkillCount(company: string): ResumeFitResult {
  const job = jobs.find((j) => j.signals.company === company)!;
  const checked = validateResume(demoPool(DEMO_EXPERIENCE, skillsOf(job)), DEMO_EXPERIENCE, { jobSkills: skillsOf(job) });
  return fitResume(applyApprovals(checked.doc, checked.flags, new Set()), page, { relevance: (t) => skillHits(skillsOf(job), t) });
}

const plain = (s: string) => s.replace(/\*\*/g, "");
const role = (d: ResumeDoc, company: string) => d.experience.find((e) => e.company === company);
const companies = (d: ResumeDoc) => [...d.experience, ...(d.projects ?? [])].map((e) => e.company);
/** The page's content as a set: which bullets are on it, whatever their order. */
const signature = (d: ResumeDoc) => [...d.experience, ...(d.projects ?? [])].flatMap((e) => e.bullets.map(plain)).sort().join("\n");
/** What the first three skills lines lead with. */
const firstSkills = (d: ResumeDoc) => d.skills.slice(0, 3).map((l) => l.items[0]);

describe("tailoring the demo experience for different jobs", () => {
  it.each(jobs.map((j) => j.signals.company))("%s: one full page with nothing unverified", (company) => {
    const { checked, fit } = tailor(company);
    expect(checked.flags).toEqual([]);
    expect(fit.fits).toBe(true);
    expect(fit.fill).toBeGreaterThan(0.93);
  });

  it("frontend job: React and TypeScript lead the skills, the frontend role leads with React, the teaching role gives way", () => {
    const { fit, summary } = tailor("Lumen Health");
    expect(fit.doc.skills[0].category).toBe("Frontend");
    expect(fit.doc.skills[0].items[0]).toBe("React");
    expect(fit.doc.skills.find((l) => l.category === "Languages")?.items[0]).toBe("TypeScript");
    expect(plain(role(fit.doc, "Lumen Health")!.bullets[0])).toMatch(/React/);
    expect(companies(fit.doc)).not.toContain("University of Washington");
    expect(summary.join(" ")).toMatch(/Your Lumen Health role is the closest match/);
  });

  it("payments job: Go, PostgreSQL and AWS lead, the payments role leads with Go, frontend bullets give way", () => {
    const pay = tailor("Cobalt Payments");
    const fe = tailor("Lumen Health");
    expect(firstSkills(pay.fit.doc).map((s) => s.replace(/ \(.*\)$/, "")).sort()).toEqual(["AWS", "Go", "PostgreSQL"]);
    expect(plain(role(pay.fit.doc, "Cobalt Payments")!.bullets[0])).toMatch(/\bGo\b/);
    expect(role(pay.fit.doc, "Lumen Health")!.bullets.length).toBeLessThan(role(fe.fit.doc, "Lumen Health")!.bullets.length);
    expect(companies(pay.fit.doc)).toContain("Trailhead");
    expect(pay.summary.join(" ")).toMatch(/Your Cobalt Payments role is the closest match/);
  });

  it("data job: Python and SQL lead the skills, the AWS pipeline bullet leads the payments role", () => {
    const { fit } = tailor("Harbor Analytics");
    expect(fit.doc.skills[0].category).toBe("Languages");
    expect(fit.doc.skills[0].items.slice(0, 2)).toEqual(["Python", "SQL"]);
    expect(plain(role(fit.doc, "Cobalt Payments")!.bullets[0])).toMatch(/AWS Lambda/);
  });

  it("backend infrastructure job: Python first, and Docker before AWS on the cloud line", () => {
    const { fit } = tailor("Atlas Cloud");
    expect(fit.doc.skills[0].items[0]).toBe("Python");
    expect(fit.doc.skills.find((l) => /Cloud/.test(l.category))?.items[0]).toBe("Docker");
  });

  it("embedded job: the systems research is the closest match", () => {
    expect(tailor("Pinecrest Robotics").summary.join(" ")).toMatch(/Your UW Systems Lab role is the closest match/);
  });

  it("gives every job its own page, where counting skills alone did not", () => {
    const now = new Set(jobs.map((j) => signature(tailor(j.signals.company).fit.doc)));
    const before = new Set(jobs.map((j) => signature(tailorBySkillCount(j.signals.company).doc)));
    expect(now.size).toBeGreaterThan(before.size);
    // Counting skills kept the teaching role on every page and left the relevant project off.
    for (const j of jobs) expect(companies(tailorBySkillCount(j.signals.company).doc)).toContain("University of Washington");
    const skillLines = new Set(jobs.map((j) => tailor(j.signals.company).fit.doc.skills.map((l) => `${l.category}:${l.items[0]}`).join("|")));
    expect(skillLines.size).toBe(jobs.length);
  });

  it("explains each page in plain words, with no em or en dashes", () => {
    for (const j of jobs) {
      const { summary } = tailor(j.signals.company);
      expect(summary.length).toBeGreaterThanOrEqual(2);
      for (const line of summary) expect(line).not.toMatch(/[–—]/);
    }
  });

  it("fills the page with the job's most relevant lines first", () => {
    const job = jobs.find((j) => j.signals.company === "Lumen Health")!;
    const rel = focusRelevance(demoFocus(job));
    const pool = demoPool(DEMO_EXPERIENCE, skillsOf(job), demoFocus(job));
    const lumen = role(pool, "Lumen Health")!.bullets.map(rel);
    expect(lumen).toEqual([...lumen].sort((a, b) => b - a));
  });
});
