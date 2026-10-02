import { cleanTitle, parseMasterExperiences, type MasterEntry } from "../master/experiences";
import { wrapBullet } from "../quality/measure";
import { entryRelevance, preferredTitle, type JobFocus } from "./focus";
import { DEFAULT_LAYOUT, LINE_HEIGHT, PAGE, sizesFor, spaceFor } from "./layout";
import { skillLineCount } from "./polish";
import type { ResumeDoc } from "./schema";

// The space budget for one page, computed by code from the same layout the page is rendered with
// (layout.ts, html.ts), so the model can write the final page to fit instead of writing too much
// and having code cut it. All heights are in points at the default 10pt layout.

/** The share of the usable page the plan aims for: between FILL_TARGET (~95%) and FIT_LIMIT (98.5%). */
export const PLAN_FILL = 0.965;
/** A bullet takes this many printed lines on average when written to "1 to 2 lines". */
export const LINES_PER_BULLET = 1.6;
/** Bullets each role aims for, by relevance rank. */
const WEIGHT_BY_RANK = [6, 5, 4, 3];
const MAX_ROLES = 4;
const MIN_BULLETS = 2;
const PROJECT_BULLETS = 2;
const MAX_PROJECTS = 2;

const usablePt = (PAGE.heightIn - 2 * PAGE.marginYIn) * 72;
const size = sizesFor(DEFAULT_LAYOUT);
const space = spaceFor(DEFAULT_LAYOUT);
const lineOf = (pt: number) => pt * LINE_HEIGHT * DEFAULT_LAYOUT.spacing;
/** One line of body text. */
export const BODY_LINE_PT = lineOf(size.bullet);
/** The page's capacity in body lines (about 64). */
export const PAGE_LINES = usablePt / BODY_LINE_PT;

const HEADER_PT = lineOf(size.name) + 1 + lineOf(size.contact) + space.afterContact;
/** Section title: space above, the title, its rule and the space under it (html.ts .h). */
const SECTION_PT = space.beforeSection + lineOf(size.sectionHeader) + 1 + 0.75 + space.afterSectionHeader;
/** An entry's title row and its company/location row, plus the gap before the next entry. */
const ENTRY_PT = lineOf(size.entryTitle) + lineOf(size.entrySub) + space.beforeEntry;

/** The bullet column at 10pt in 1/1000 em, with the same 0.97 safety as the rest of the estimates. */
const BULLET_UNITS = ((PAGE.widthIn - 2 * PAGE.marginXIn - 0.1875) * 72 / DEFAULT_LAYOUT.body) * 1000 * 0.97;
/** About how many characters of typical bullet text one line holds. */
export const CHARS_PER_LINE = 115;

/** Printed lines a bullet takes at 10pt (estimated by Times New Roman widths, no browser). */
export const bulletLines = (text: string) => Math.max(1, wrapBullet(text, BULLET_UNITS).lines.length);

const bulletsOf = (block: string) =>
  block
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => /^[-*•]\s+\S/.test(l))
    .map((l) => l.replace(/^[-*•]\s+/, ""));

/** The lines under every heading matching `heading`. */
function sectionLines(master: string, heading: RegExp): string[] {
  const out: string[] = [];
  let inside = false;
  for (const raw of master.split(/\r?\n/)) {
    const line = raw.trim();
    const h = line.match(/^#{1,6}\s+(.*)$/);
    if (h) {
      inside = heading.test(h[1]);
      continue;
    }
    if (inside && line) out.push(line);
  }
  return out;
}

export interface PlannedEntry {
  company: string;
  /** The title to use for this job (her main or alt title). */
  title: string;
  dates: string;
  /** Bullets to write for it. */
  bullets: number;
  /** Bullets its own text in her experience has. */
  sourceBullets: number;
}

export interface PagePlan {
  /** The page's capacity in 10pt body lines. */
  pageLines: number;
  /** Lines the header, section titles, education, skills and leadership take. */
  fixedLines: number;
  /** Lines left for experience and project bullets. */
  bulletLines: number;
  /** Average printed lines per bullet that fills those lines (1 to 2): above 1.6 means "write fuller bullets". */
  linesPerBullet: number;
  /** Printed lines the full skills section takes (every skill kept). */
  skillLines: number;
  leadershipLines: number;
  /** Roles to write, most relevant first. */
  roles: PlannedEntry[];
  projects: PlannedEntry[];
  /** Total bullets the plan asks for. */
  totalBullets: number;
}

/** Skills lines as her inventory lists them, for counting how much room they take. */
function inventoryLines(master: string): { category: string; items: string[] }[] {
  return sectionLines(master, /skill/i)
    .map((l) => l.replace(/\*\*/g, "").match(/^[-*•]?\s*([^:]{1,60}):\s*(.+)$/))
    .filter((m): m is RegExpMatchArray => m !== null)
    .map((m) => ({ category: m[1].trim(), items: m[2].split(",").map((s) => s.trim()).filter(Boolean) }));
}

/**
 * How one page should be spent for this job: which roles and projects, and how many bullets each,
 * from the space left after everything that is always on the page. Roles are ranked by what the
 * job is about (focus.ts) when a focus is given, else kept in her order.
 */
export function planPage(master: string, focus?: JobFocus, now = new Date()): PagePlan {
  const entries = parseMasterExperiences(master);
  const isProject = (m: MasterEntry) => /project/i.test(m.section);
  const asLike = (m: MasterEntry) => ({ title: m.title, company: m.company, dates: m.dates, bullets: bulletsOf(m.block) });
  const all = entries.map(asLike);
  const rank = (list: MasterEntry[]) =>
    focus
      ? list.map((m, i) => ({ m, i, s: entryRelevance(focus, asLike(m), all, now) })).sort((a, b) => b.s - a.s || a.i - b.i).map((x) => x.m)
      : list;
  const roles = rank(entries.filter((m) => !isProject(m)));
  const projects = rank(entries.filter(isProject));

  // Always on the page: header, education, skills (every skill), leadership.
  const eduLines = sectionLines(master, /education/i);
  const eduEntries = eduLines.filter((l) => /^\*\*.+\*\*$/.test(l)).length || (eduLines.length ? 1 : 0);
  const eduBulletLines = eduLines.filter((l) => /^[-*•]\s+/.test(l)).reduce((s, l) => s + bulletLines(l.replace(/^[-*•]\s+/, "")), 0);
  const skills = inventoryLines(master).filter((l) => !/^usage/i.test(l.category));
  const skillLines = skills.reduce((s, l) => s + skillLineCount(l), 0);
  const leadershipLines = sectionLines(master, /leadership|involvement|activit|extracurricular|volunteer/i).filter((l) => /^[-*•]\s+/.test(l)).length;

  const sections = (eduEntries ? 1 : 0) + 1 + (skills.length ? 1 : 0) + (leadershipLines ? 1 : 0);
  const fixedPt =
    HEADER_PT +
    sections * SECTION_PT +
    eduEntries * ENTRY_PT +
    (eduBulletLines + skillLines + leadershipLines) * BODY_LINE_PT;

  const targetPt = usablePt * PLAN_FILL;
  type Pick = { m: MasterEntry; project: boolean; score: number };
  const scoreOf = (m: MasterEntry, i: number) => (focus ? entryRelevance(focus, asLike(m), all, now) : -i);
  const rolePicks: Pick[] = roles.map((m, i) => ({ m, project: false, score: scoreOf(m, i) }));
  const projectPicks: Pick[] = projects.map((m, i) => ({ m, project: true, score: scoreOf(m, 100 + i) }));
  const cap = (p: Pick) => (p.project ? Math.min(PROJECT_BULLETS, Math.max(1, bulletsOf(p.m.block).length)) : Math.max(MIN_BULLETS, bulletsOf(p.m.block).length));
  /** Lines left for bullets with these entries on the page. */
  const roomLines = (picks: Pick[]) => (targetPt - fixedPt - picks.length * ENTRY_PT - (picks.some((p) => p.project) ? SECTION_PT : 0)) / BODY_LINE_PT;
  const capacity = (picks: Pick[]) => Math.floor(roomLines(picks) / LINES_PER_BULLET);
  const available = (picks: Pick[]) => picks.reduce((s, p) => s + cap(p), 0);

  // The 3 most relevant roles first. Then the 4th role and up to 2 projects, most relevant first,
  // each only when the page has room her chosen entries can't fill, or when it shows more of this
  // job than the weakest chosen role and every role still gets 3 bullets.
  let chosen = rolePicks.slice(0, 3);
  const extras = [...rolePicks.slice(3, MAX_ROLES), ...projectPicks.slice(0, MAX_PROJECTS)].sort((a, b) => b.score - a.score);
  for (const c of extras) {
    const next = [...chosen, c];
    const roleCount = next.filter((p) => !p.project).length;
    const projectBullets = next.filter((p) => p.project).reduce((s, p) => s + cap(p), 0);
    const roomy = capacity(next) - projectBullets >= roleCount * 3;
    const needed = available(chosen) < capacity(chosen);
    const weakest = Math.min(...chosen.filter((p) => !p.project).map((p) => p.score));
    if ((needed && capacity(next) > available(chosen)) || (roomy && c.score > weakest)) chosen = next;
  }

  // Split the bullets: projects get their 2, roles share the rest by relevance rank, never more than
  // a role's own source lines (the model may merge or split, not invent), never fewer than 2.
  const projectsChosen = chosen.filter((p) => p.project);
  const rolesChosen = chosen.filter((p) => !p.project).sort((a, b) => b.score - a.score);
  const projectBullets = projectsChosen.reduce((s, p) => s + cap(p), 0);
  const total = Math.max(rolesChosen.length * MIN_BULLETS, capacity(chosen) - projectBullets);
  const caps = rolesChosen.map(cap);
  const weights = rolesChosen.map((_, i) => WEIGHT_BY_RANK[Math.min(i, WEIGHT_BY_RANK.length - 1)]);
  const counts = rolesChosen.map((_, i) => Math.min(MIN_BULLETS, caps[i]));
  let left = total - counts.reduce((a, b) => a + b, 0);
  const wsum = weights.reduce((a, b) => a + b, 0);
  while (left > 0) {
    // The next bullet goes to the role furthest below its weighted share that still has source lines.
    const sum = counts.reduce((a, b) => a + b, 0) + 1;
    let best = -1;
    let bestGap = -Infinity;
    rolesChosen.forEach((_, i) => {
      if (counts[i] >= caps[i]) return;
      const gap = (weights[i] / wsum) * sum - counts[i];
      if (gap > bestGap) {
        bestGap = gap;
        best = i;
      }
    });
    if (best < 0) break;
    counts[best]++;
    left--;
  }
  const toPlanned = (p: Pick, bullets: number): PlannedEntry => ({
    company: p.m.company,
    title: focus ? preferredTitle(p.m.title, focus) : cleanTitle(p.m.title),
    dates: p.m.dates,
    bullets,
    sourceBullets: bulletsOf(p.m.block).length,
  });
  const rolePlan = rolesChosen.map((p, i) => toPlanned(p, counts[i]));
  const projectPlan = projectsChosen.map((p) => toPlanned(p, cap(p)));
  const totalBullets = counts.reduce((a, b) => a + b, 0) + projectBullets;
  const lines = Math.max(0, Math.floor(roomLines(chosen)));
  return {
    pageLines: Math.floor(PAGE_LINES),
    fixedLines: Math.round(fixedPt / BODY_LINE_PT),
    bulletLines: lines,
    linesPerBullet: totalBullets ? Math.min(2, Math.max(1, Math.round((lines / totalBullets) * 10) / 10)) : LINES_PER_BULLET,
    skillLines,
    leadershipLines,
    roles: rolePlan,
    projects: projectPlan,
    totalBullets,
  };
}

/** Lines the page is short by (positive) at a measured fill, rounded down. */
export function linesShort(fill: number, target = PLAN_FILL): number {
  return Math.max(0, Math.floor((target - fill) * PAGE_LINES));
}

/** The plan in plain words for the user message. `shows` adds what each entry shows for this job. */
export function describePlan(plan: PagePlan, shows: (company: string) => string = () => ""): string {
  const roleBullets = plan.roles.reduce((s, r) => s + r.bullets, 0);
  const lines = [
    "PAGE PLAN (worked out by the app from the real page layout, so the page ends full but never runs over; write to it):",
    `- One page holds about ${plan.pageLines} lines of 10pt text. The header, section titles, Education, Skills (about ${plan.skillLines} lines with every skill kept)${plan.leadershipLines ? " and Leadership" : ""} take about ${plan.fixedLines}. About ${plan.bulletLines} lines are left for Experience${plan.projects.length ? " and Projects" : ""}.`,
    `- A line holds about ${CHARS_PER_LINE} characters. A bullet is 1 line (up to about ${CHARS_PER_LINE - 10} characters) or 2 lines (up to about ${2 * CHARS_PER_LINE - 10}). Never 3.`,
    `- Experience, ${roleBullets} bullets in total, most relevant first within each role (keep the roles in reverse-chronological order on the page):`,
    ...plan.roles.map((r, i) => {
      const what = shows(r.company);
      return `  ${i + 1}. ${r.company} (${r.title}): ${r.bullets} bullet${r.bullets === 1 ? "" : "s"}${what ? `. Shows ${what}` : ""}.`;
    }),
  ];
  if (plan.projects.length) {
    lines.push(`- Projects: ${plan.projects.map((p) => `${p.company} (${p.bullets} bullet${p.bullets === 1 ? "" : "s"})`).join(", ")}.`);
  } else {
    lines.push("- Projects: none (no room). Leave \"projects\" empty.");
  }
  const fuller = plan.linesPerBullet >= 1.8 ? " Your experience has few lines for this much room, so make most bullets a full 2 lines (concrete scope, tools and results from the same role; nothing invented)." : "";
  lines.push(`- That is ${plan.totalBullets} bullets, about ${plan.bulletLines} lines. Fewer leaves the page short; more runs over.${fuller}`);
  return lines.join("\n");
}

/**
 * A node-side estimate of how full a page is (1 = reaches the bottom margin), from the same
 * geometry as the plan. The browser measures the real rendering (fit.ts); this stands in for it in
 * tests and the offline eval. A larger body font both raises each line and wraps text sooner.
 */
export function estimatePageFill(doc: ResumeDoc): number {
  const layout = doc.layout ?? DEFAULT_LAYOUT;
  const grow = layout.body / DEFAULT_LAYOUT.body;
  const projects = doc.projects ?? [];
  const sections = [doc.education.length, doc.experience.length, projects.length, doc.skills.length, doc.leadership.length].filter((n) => n > 0).length;
  const entries = doc.education.length + doc.experience.length + projects.length;
  const bullets = [...doc.education, ...doc.experience, ...projects].flatMap((e) => e.bullets);
  const textLines = bullets.reduce((s, b) => s + bulletLines(b), 0) + doc.skills.reduce((s, l) => s + skillLineCount(l), 0) + doc.leadership.length;
  const fixedPt = HEADER_PT + sections * SECTION_PT + entries * ENTRY_PT;
  return ((fixedPt * grow + textLines * BODY_LINE_PT * grow * grow) * layout.spacing) / usablePt;
}
