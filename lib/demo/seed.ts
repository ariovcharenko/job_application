import { db, saveMasterProfile, savePreferences, saveProfile } from "../db";
import { loadGeo } from "../geo/index";
import { assessJob, toStoredBreakdown } from "../intake/analyze";
import { skillCoverage, skillHits } from "../resume/coverage";
import { autoBold, backfillFromExperience } from "../resume/engine/backfill";
import { pageFill } from "../resume/engine/fit";
import { buildHeader } from "../resume/engine/index";
import { renderResumeDocx } from "../resume/engine/render";
import { storeJobResume } from "../resume/engine/save";
import type { ResumeDoc } from "../resume/engine/schema";
import { fitResume } from "../resume/engine/trim";
import { applyApprovals, validateResume } from "../resume/engine/validate";
import { cleanTitle, parseMasterExperiences } from "../resume/master/experiences";
import { parseSkillInventory } from "../resume/master/skills";
import { blankApplication } from "../tracker/blank";
import { normalizeRoleType } from "../tracker/csvMap";
import type { Application } from "../types";
import { DEMO_ANSWERS, DEMO_CONTACTS, DEMO_EXPERIENCE, DEMO_JOBS, DEMO_PREFERENCES, DEMO_PROFILE } from "./data";

// Fills this browser with the demo candidate (lib/demo/data.ts) for showing the app off. Local
// copies of the app only: it replaces every job, resume, contact, answer and the Profile,
// Preferences and experience (API keys and other settings are kept). Resumes are built from the
// demo experience word for word, checked by validateResume like any tailored resume, and fitted
// to one full page by the same fit loop, measured on the real page in this browser.

/** Only a local copy of the app may load demo data, so a real account can never be overwritten. */
export function isLocalHost(hostname: string): boolean {
  return /^(localhost|127\.0\.0\.1|\[::1\]|::1)$/.test(hostname) || hostname.endsWith(".localhost") || hostname.endsWith(".test");
}

const day = 24 * 60 * 60 * 1000;
const isoDaysAgo = (n: number, now: number) => {
  const d = new Date(now - n * day);
  const p = (x: number) => String(x).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

/** "- **Languages:** Go, AWS (Lambda, SQS), SQL" -> lines, keeping commas inside parentheses. */
export function skillLines(master: string): ResumeDoc["skills"] {
  const out: ResumeDoc["skills"] = [];
  let inside = false;
  for (const raw of master.split(/\r?\n/)) {
    const line = raw.trim();
    const h = line.match(/^#{1,6}\s+(.*)$/);
    if (h) {
      inside = /skill/i.test(h[1]);
      continue;
    }
    const m = inside ? line.replace(/\*\*/g, "").match(/^[-*•]\s*([^:]+):\s*(.+)$/) : null;
    if (!m) continue;
    const items: string[] = [];
    let depth = 0;
    let cur = "";
    for (const ch of m[2]) {
      if (ch === "(") depth++;
      if (ch === ")") depth--;
      if (ch === "," && depth === 0) {
        items.push(cur.trim());
        cur = "";
      } else cur += ch;
    }
    if (cur.trim()) items.push(cur.trim());
    out.push({ category: m[1].trim(), items });
  }
  return out;
}

/** Everything in the demo experience as a resume pool, bullets ordered by this job's skills. */
export function demoPool(master: string, jobSkills: string[]): ResumeDoc {
  const entries = parseMasterExperiences(master);
  const relevance = (text: string) => skillHits(jobSkills, text);
  const inventory = parseSkillInventory(master);
  const header = (m: (typeof entries)[number]) => ({ title: cleanTitle(m.title), company: m.company, location: m.location, dates: m.dates, bullets: [] as string[] });
  const base: ResumeDoc = {
    education: [
      {
        school: "University of Washington",
        location: "Seattle, WA",
        degree: "B.S. Computer Science",
        dates: "Jun 2026",
        bullets: ["GPA: 3.8/4.0", "Relevant coursework: Distributed Systems, Databases, Machine Learning, Operating Systems, Computer Networks"],
      },
    ],
    experience: entries.filter((m) => /experience/i.test(m.section)).map(header),
    projects: entries
      .filter((m) => /project/i.test(m.section))
      .map((m) => ({
        ...header(m),
        bullets: m.block
          .split("\n")
          .filter((l) => /^[-*•]\s+/.test(l.trim()))
          .map((l) => autoBold(l.trim().replace(/^[-*•]\s+/, ""), inventory, master)),
      })),
    skills: skillLines(master),
    leadership: [
      { role: "ACM Student Chapter, Vice President", dates: "Sep 2024 - Present" },
      { role: "Women in Computing, Mentor", dates: "Jan 2025 - Present" },
    ],
    meta: { matchedKeywords: jobSkills, gaps: [], valuesReflected: [] },
  };
  return backfillFromExperience(base, master, relevance).doc;
}

export interface DemoReport {
  jobs: number;
  resumes: { company: string; fill: number; fits: boolean; flags: number; body: number }[];
}

export async function seedDemo(now = Date.now()): Promise<DemoReport> {
  if (typeof location !== "undefined" && !isLocalHost(location.hostname)) throw new Error("Demo data can only be loaded on a local copy of the app.");

  await db.transaction("rw", [db.applications, db.tailoredResumes, db.contacts, db.answerBank, db.feed, db.baseResumes], async () => {
    await Promise.all([db.applications.clear(), db.tailoredResumes.clear(), db.contacts.clear(), db.answerBank.clear(), db.feed.clear(), db.baseResumes.clear()]);
  });
  await saveProfile(DEMO_PROFILE);
  await savePreferences(DEMO_PREFERENCES);
  await saveMasterProfile(DEMO_EXPERIENCE);

  const geo = await loadGeo();
  const header = buildHeader(DEMO_PROFILE);
  const report: DemoReport = { jobs: 0, resumes: [] };
  const ids = new Map<string, number>();

  for (const [i, job] of DEMO_JOBS.entries()) {
    const s = job.signals;
    const assessment = assessJob(s, DEMO_PREFERENCES, DEMO_EXPERIENCE, job.jd, { profile: DEMO_PROFILE, geo });
    const created = now - (40 - i) * day;
    const app: Application = {
      ...blankApplication(),
      company: s.company,
      role: s.role,
      url: job.url,
      location: s.location,
      workMode: s.workMode,
      salary: s.salary,
      roleType: normalizeRoleType(s.role),
      visa: s.visaSignal,
      jdText: job.jd,
      fitScore: assessment.score.score,
      fitBreakdown: JSON.stringify(toStoredBreakdown({ ...assessment, signals: s })),
      stage: job.stage,
      appliedDate: job.appliedDaysAgo !== undefined ? isoDaysAgo(job.appliedDaysAgo, now) : "",
      respondDate: job.respondedDaysAgo !== undefined ? isoDaysAgo(job.respondedDaysAgo, now) : "",
      notes: job.notes ?? "",
      referral: job.referral ?? "",
      ...(job.triage ? { triage: job.triage } : {}),
      createdAt: created,
      updatedAt: created,
    };
    const id = (await db.applications.add(app)) as number;
    ids.set(s.company, id);
    report.jobs++;

    if (!job.resume) continue;
    const jobSkills = [...s.mustHaveSkills, ...s.niceToHaveSkills];
    const checked = validateResume(demoPool(DEMO_EXPERIENCE, jobSkills), DEMO_EXPERIENCE, { jobSkills });
    const pool = applyApprovals(checked.doc, checked.flags, new Set());
    const fit = fitResume(pool, (d) => pageFill(header, d), { relevance: (text) => skillHits(jobSkills, text) });
    const bytes = await renderResumeDocx(header, fit.doc);
    const before = skillCoverage(jobSkills, DEMO_EXPERIENCE)?.percent ?? 0;
    const after = skillCoverage(jobSkills, JSON.stringify(fit.doc))?.percent ?? 0;
    await storeJobResume(id, bytes, { v: 2, doc: checked.doc, approved: [], final: fit.doc }, { before, after });
    report.resumes.push({ company: s.company, fill: fit.fill, fits: fit.fits, flags: checked.flags.length, body: fit.layout.body });
  }

  for (const c of DEMO_CONTACTS) {
    const applicationId = ids.get(c.company);
    if (applicationId === undefined) continue;
    const { company: _company, ...contact } = c;
    await db.contacts.add({ ...contact, applicationId });
  }
  for (const a of DEMO_ANSWERS) await db.answerBank.add({ ...a });
  return report;
}
