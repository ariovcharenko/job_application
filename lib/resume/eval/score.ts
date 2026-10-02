import { hasSkill, isSoftSkill } from "../master/skills";
import { FILL_TARGET, FIT_LIMIT } from "../engine/trim";
import { plain, resumeText, validateResume } from "../engine/validate";
import type { ResumeDoc } from "../engine/schema";

// An offline score for a tailored resume, so two ways of tailoring (ours and a plain one-prompt
// baseline) can be compared on the same fictional candidate and jobs without anyone reading every
// page. Every part is computed by code from the page, her experience and the job's skills lists.

export interface EvalJob {
  company: string;
  role: string;
  jd: string;
  /** The job's required skills, most important first. */
  must: string[];
  nice: string[];
}

export interface ResumeScore {
  /** Share of the job's must-haves she has that the page shows (0 to 1). */
  mustCoverage: number;
  /** Share of the job's nice-to-haves she has that the page shows. */
  niceCoverage: number;
  /** Share of her skills-inventory items still on the page (the "it cuts my skills" metric). */
  skillsRetained: number;
  /** Her inventory items the page lost. */
  droppedSkills: string[];
  /** Page fill as measured (1 = reaches the bottom margin). */
  fill: number;
  /** Blocking flags (possible inventions) and notes, from the same checks the app runs. */
  blockFlags: number;
  noteFlags: number;
  /** Mean number of the job's skills named per experience/project bullet. */
  specificity: number;
  /** Distinct opening verbs / bullets (1 = no verb repeated). */
  verbVariety: number;
  bullets: number;
  /** 0 to 100, weighted (see SCORE_WEIGHTS). */
  total: number;
}

export const SCORE_WEIGHTS = { must: 30, retained: 20, fill: 15, honesty: 15, specificity: 10, verbs: 10 };

/** Her skills inventory as written on her skills lines ("AWS (Lambda, SQS, S3)" stays one item). */
export function inventoryItems(master: string): string[] {
  const out: string[] = [];
  let inside = false;
  for (const raw of master.split(/\r?\n/)) {
    const line = raw.trim();
    const h = line.match(/^#{1,6}\s+(.*)$/);
    if (h) {
      inside = /skill/i.test(h[1]);
      continue;
    }
    const m = inside ? line.replace(/\*\*/g, "").match(/^[-*•]?\s*([^:]{1,60}):\s*(.+)$/) : null;
    if (!m) continue;
    let depth = 0;
    let cur = "";
    for (const ch of m[2]) {
      if (ch === "(") depth++;
      if (ch === ")") depth = Math.max(0, depth - 1);
      if (ch === "," && depth === 0) {
        out.push(cur.trim());
        cur = "";
      } else cur += ch;
    }
    if (cur.trim()) out.push(cur.trim());
  }
  return out.filter(Boolean);
}

/** Share of `skills` (only those she has) that `text` shows; 1 when there are none. */
function coverage(skills: string[], master: string, text: string): number {
  const mine = skills.filter((s) => !isSoftSkill(s) && hasSkill(s, [], master));
  if (mine.length === 0) return 1;
  return mine.filter((s) => hasSkill(s, [], text)).length / mine.length;
}

/** 1 inside her 93 to 99% band, falling off linearly to 0 at 25 points outside it; 0 if over a page. */
export function fillScore(fill: number): number {
  if (fill > 1) return 0;
  if (fill >= FILL_TARGET && fill <= FIT_LIMIT) return 1;
  const off = fill < FILL_TARGET ? FILL_TARGET - fill : fill - FIT_LIMIT;
  return Math.max(0, 1 - off / 0.25);
}

export function scoreResume(doc: ResumeDoc, input: { master: string; job: EvalJob; fill: number }): ResumeScore {
  const { master, job, fill } = input;
  const text = resumeText(doc);
  const bullets = [...doc.experience, ...(doc.projects ?? [])].flatMap((e) => e.bullets).map(plain);
  const jobSkills = [...job.must, ...job.nice];

  const items = inventoryItems(master);
  const dropped = items.filter((i) => !hasSkill(i, [], text));
  const retained = items.length ? (items.length - dropped.length) / items.length : 1;

  const { flags } = validateResume(doc, master, { jobSkills });
  const blockFlags = flags.filter((f) => f.severity === "block").length;
  const noteFlags = flags.length - blockFlags;

  const perBullet = bullets.map((b) => jobSkills.filter((s) => hasSkill(s, [], b)).length);
  const specificity = perBullet.length ? perBullet.reduce((a, b) => a + b, 0) / perBullet.length : 0;
  const verbs = bullets.map((b) => (b.trim().split(/\s+/)[0] ?? "").toLowerCase()).filter(Boolean);
  const verbVariety = verbs.length ? new Set(verbs).size / verbs.length : 0;

  const mustCoverage = coverage(job.must, master, text);
  const niceCoverage = coverage(job.nice, master, text);
  const w = SCORE_WEIGHTS;
  const total =
    w.must * mustCoverage +
    w.retained * retained +
    w.fill * fillScore(fill) +
    w.honesty * Math.max(0, 1 - blockFlags / 3) +
    w.specificity * Math.min(1, specificity / 1.5) +
    w.verbs * verbVariety;

  return {
    mustCoverage,
    niceCoverage,
    skillsRetained: retained,
    droppedSkills: dropped,
    fill,
    blockFlags,
    noteFlags,
    specificity,
    verbVariety,
    bullets: bullets.length,
    total: Math.round(total),
  };
}
