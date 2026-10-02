import type { FlagSpot, Target } from "./edit";
import { BODY_STEP_PT, DEFAULT_LAYOUT, MAX_BODY_PT, MAX_SPACING, PAGE, SPACING_STEP, type Layout } from "./layout";
import { entryRelevance, focusRelevance, type JobFocus } from "./focus";
import { bulletScore, type RelevanceFn } from "./relevance";
import type { ResumeDoc } from "./schema";

// Measures the page and makes it fit exactly one page, deterministically.
//
// The model writes the final page to a space budget computed from this same layout (budget.ts),
// so normally nothing here changes the content. When the page still runs over (a long bullet, a
// line she kept), code:
//  1. trims the least relevant content until the page fits: leadership, extra project bullets,
//     then the lowest-relevance bullets. Never a skill, never education, never the header; and
//  2. puts trimmed content back, most valuable first, wherever it still fits.
// When it runs short, fitResume raises the type within 10 to 11pt as a last resort (the
// tailoring pipeline asks the model for more content first).
//
// Everything here is pure. The page is measured by a function passed in (fit.ts measures the real
// HTML rendering in the browser; tests pass a fake), so the same pool always gives the same page.

/** Fewest bullets a role keeps before the role itself would go. */
const MIN_BULLETS_PER_ENTRY = 2;
/** "Choose 3 to 4 experiences": a fourth role is the first whole role to go. */
const MIN_ROLES = 3;
/** Bullets each role aims for, by relevance rank: more for the most relevant role, fewer after. */
const TARGET_BY_RANK = [6, 5, 4, 3];

/**
 * The largest share of the page's usable height (inside the margins) that still counts as fitting.
 * Her spec is 93 to 99% full; 98.5% keeps a hair of room for Word laying text out slightly taller
 * than the browser, since a second page is worse than a sliver of white space.
 */
export const FIT_LIMIT = 0.985;
/**
 * The least a finished page fills: her spec says 93%, and never more than 0.5in blank at the
 * bottom, which on a 10.4in usable page is the stricter of the two (about 95.2%).
 */
export const FILL_TARGET = Math.max(0.93, 1 - 0.5 / (PAGE.heightIn - 2 * PAGE.marginYIn));
/** Her rule: when restoring bullets to fill the page, a role gets at most this many. */
export const MAX_RESTORED_BULLETS = 5;
/** Projects show at most this many bullets each. */
export const MAX_PROJECT_BULLETS = 2;

/** Measures a candidate page: its content height as a share of the usable page height (1 = full). */
export type MeasureFn = (doc: ResumeDoc) => number;

/** Where each visible piece sits in the pool, so edits and comments on the page reach the pool. */
export interface PoolMap {
  education: { entry: number; bullets: number[] }[];
  experience: { entry: number; bullets: number[] }[];
  projects: { entry: number; bullets: number[] }[];
  skills: number[];
  leadership: number[];
}

export interface FitResult {
  /** The page as shown and downloaded. */
  doc: ResumeDoc;
  /** What is left off to fit one page, least relevant first. */
  removed: string[];
  /** What the fill step put back after trimming. */
  restored: string[];
  fits: boolean;
  /** Content height as a share of the usable page (0.96 = "uses 96% of the page"). */
  fill: number;
  /** Whole roles and projects left off, for the "Tailored for this job" summary. */
  leftOffEntries: { kind: "role" | "project"; title: string; company: string }[];
  /** Fits, but under FILL_TARGET with nothing left in the pool that fits: ask for more content. */
  underfilled: boolean;
  map: PoolMap;
}

export interface FitOptions {
  /** Job-skill hits for a bullet's plain text (lib/resume/coverage.ts skillHits). Ignored when `focus` is given. */
  relevance?: RelevanceFn;
  /**
   * What this job is about (focus.ts). Ranks bullets by must-have and nice-to-have skills and the
   * job's domains and responsibilities; ranks roles and projects by their best bullets, title family
   * and recency, so a less relevant fourth role gives way before a more relevant project.
   */
  focus?: JobFocus;
  limit?: number;
  fillTarget?: number;
  maxSteps?: number;
  /** false: trim only, don't put cut pieces back (fitResume grows the type first, then restores). */
  restore?: boolean;
  /** Restoring never takes a role above this many bullets. */
  maxBulletsPerRole?: number;
}

// Keys for the pieces that can be left off: "L:i" leadership item, "X:i" a whole role, "x:i:j" a
// role's bullet, "P:i" a whole project, "p:i:j" a project's bullet, "e:i:j" an education detail,
// "S:i" a skills line.
type Key = string;

const plain = (s: string) => s.replace(/\*\*/g, "");

function build(pool: ResumeDoc, off: Set<Key>): { doc: ResumeDoc; map: PoolMap } {
  const map: PoolMap = { education: [], experience: [], projects: [], skills: [], leadership: [] };
  const education = pool.education.map((e, i) => {
    const bullets = e.bullets.map((_, j) => j).filter((j) => !off.has(`e:${i}:${j}`));
    map.education.push({ entry: i, bullets });
    return { ...e, bullets: bullets.map((j) => e.bullets[j]) };
  });
  const experience: ResumeDoc["experience"] = [];
  pool.experience.forEach((e, i) => {
    if (off.has(`X:${i}`)) return;
    const bullets = e.bullets.map((_, j) => j).filter((j) => !off.has(`x:${i}:${j}`));
    map.experience.push({ entry: i, bullets });
    experience.push({ ...e, bullets: bullets.map((j) => e.bullets[j]) });
  });
  const projects: ResumeDoc["experience"] = [];
  (pool.projects ?? []).forEach((e, i) => {
    if (off.has(`P:${i}`)) return;
    const bullets = e.bullets.map((_, j) => j).filter((j) => !off.has(`p:${i}:${j}`));
    map.projects.push({ entry: i, bullets });
    projects.push({ ...e, bullets: bullets.map((j) => e.bullets[j]) });
  });
  map.skills = pool.skills.map((_, i) => i).filter((i) => !off.has(`S:${i}`));
  map.leadership = pool.leadership.map((_, i) => i).filter((i) => !off.has(`L:${i}`));
  return {
    doc: {
      ...pool,
      education,
      experience,
      ...(pool.projects ? { projects } : {}),
      skills: map.skills.map((i) => pool.skills[i]),
      leadership: map.leadership.map((i) => pool.leadership[i]),
    },
    map,
  };
}

interface Ranking {
  /** score[i][j]: keep-score of pool experience i, bullet j. */
  score: number[][];
  /** Bullets each pool role aims for. */
  target: number[];
  /** Role relevance (higher = keep). */
  entryScore: number[];
  /** With a job focus: project relevance on the same scale as entryScore, so the two can be compared. */
  projectScore?: number[];
  /** With a job focus: each role bullet's relevance alone (no metric or position credit). */
  relevance?: number[][];
  /** With a job focus: the mean relevance of each project's two most relevant bullets. */
  projectRelevance?: number[];
}

function rank(pool: ResumeDoc, opts: Pick<FitOptions, "relevance" | "focus">): Ranking {
  const focus = opts.focus;
  const relevance = focus ? focusRelevance(focus) : opts.relevance;
  const score = pool.experience.map((e) => e.bullets.map((b, j) => bulletScore(b, j, e.bullets.length, relevance)));
  // A role's relevance. With a job focus: its two most relevant bullets, its title's family and its
  // recency (focus.ts entryRelevance). Without: its three strongest bullets (a role the model gave
  // more bullets to, and whose bullets show more of the job's skills, ranks higher).
  const everything = [...pool.experience, ...(pool.projects ?? [])];
  const entryScore = focus
    ? pool.experience.map((e) => entryRelevance(focus, e, everything))
    : score.map((s) => [...s].sort((a, b) => b - a).slice(0, 3).reduce((a, b) => a + b, 0));
  const projectScore = focus ? (pool.projects ?? []).map((p) => entryRelevance(focus, p, everything)) : undefined;
  const order = entryScore.map((v, i) => ({ v, i })).sort((a, b) => b.v - a.v || a.i - b.i);
  const target = new Array<number>(pool.experience.length).fill(TARGET_BY_RANK[TARGET_BY_RANK.length - 1]);
  order.forEach(({ i }, r) => (target[i] = TARGET_BY_RANK[Math.min(r, TARGET_BY_RANK.length - 1)]));
  if (!focus || !relevance) return { score, target, entryScore };
  const top2 = (xs: number[]) => {
    const t = [...xs].sort((a, b) => b - a).slice(0, 2);
    return t.length ? t.reduce((a, b) => a + b, 0) / t.length : 0;
  };
  return {
    score,
    target,
    entryScore,
    projectScore,
    relevance: pool.experience.map((e) => e.bullets.map((b) => relevance(b))),
    projectRelevance: (pool.projects ?? []).map((p) => top2(p.bullets.map((b) => relevance(b)))),
  };
}

function describe(pool: ResumeDoc, key: Key): string {
  const [kind, a, b] = key.split(":");
  const i = Number(a);
  const j = Number(b);
  if (kind === "L") return `Leadership: ${plain(pool.leadership[i].role)}`;
  if (kind === "X") return `Role: ${pool.experience[i].title}, ${pool.experience[i].company}`;
  if (kind === "x") return `${pool.experience[i].company}: "${plain(pool.experience[i].bullets[j])}"`;
  if (kind === "P") return `Project: ${pool.projects![i].company}`;
  if (kind === "p") return `${pool.projects![i].company}: "${plain(pool.projects![i].bullets[j])}"`;
  if (kind === "e") return `${pool.education[i].school}: "${plain(pool.education[i].bullets[j])}"`;
  return `Skills line: ${pool.skills[i].category}`;
}

/** Visible bullet indexes of pool role i. */
const visibleBullets = (pool: ResumeDoc, off: Set<Key>, i: number) =>
  pool.experience[i].bullets.map((_, j) => j).filter((j) => !off.has(`x:${i}:${j}`));

/**
 * The lowest-scoring bullet of the role furthest above `floorOf(role)`'s aim: the role with the
 * most bullets over its target gives one up; ties go to the role holding the weaker bullet, then to
 * the later role. Within the role, the lowest score goes (ties: the later bullet).
 */
function bulletCut(pool: ResumeDoc, off: Set<Key>, rk: Ranking, floorOf: (i: number) => number): Key | null {
  let best: { i: number; j: number; excess: number; s: number } | null = null;
  for (let i = 0; i < pool.experience.length; i++) {
    if (off.has(`X:${i}`)) continue;
    const vis = visibleBullets(pool, off, i);
    if (vis.length <= Math.max(MIN_BULLETS_PER_ENTRY, floorOf(i))) continue;
    let j = vis[0];
    for (const k of vis) if (rk.score[i][k] <= rk.score[i][j]) j = k;
    const excess = vis.length - rk.target[i];
    const s = rk.score[i][j];
    if (!best || excess > best.excess || (excess === best.excess && (s < best.s || (s === best.s && i > best.i)))) best = { i, j, excess, s };
  }
  return best ? `x:${best.i}:${best.j}` : null;
}

/** How much more a project's bullets must show of the job before a role's bullet gives way to it. */
const PROJECT_MARGIN = 0.5;
/** A role keeps at least this many bullets when giving way to a project. */
const KEEP_FOR_PROJECTS = 3;

/** The role bullet with the least relevance under `below`, from a role above KEEP_FOR_PROJECTS bullets. */
function weakBullet(pool: ResumeDoc, off: Set<Key>, rel: number[][], score: number[][], below: number): Key | null {
  let best: { i: number; j: number } | null = null;
  for (let i = 0; i < pool.experience.length; i++) {
    if (off.has(`X:${i}`)) continue;
    const vis = visibleBullets(pool, off, i);
    if (vis.length <= KEEP_FOR_PROJECTS) continue;
    for (const j of vis) {
      if (rel[i][j] >= below) continue;
      if (!best || rel[i][j] < rel[best.i][best.j] || (rel[i][j] === rel[best.i][best.j] && score[i][j] <= score[best.i][best.j])) best = { i, j };
    }
  }
  return best ? `x:${best.i}:${best.j}` : null;
}

/** The next piece to leave off, least relevant first, or null when nothing more can go. */
function nextCut(pool: ResumeDoc, off: Set<Key>, rk: Ranking): Key | null {
  // 1. Leadership goes first: her rule is "include only if space remains".
  for (let i = pool.leadership.length - 1; i >= 0; i--) if (!off.has(`L:${i}`)) return `L:${i}`;

  // 1b. Project bullets beyond the first, then whole projects (last listed first). With a job focus,
  //     least relevant first, and a fourth role less relevant than every project still shown goes
  //     before them (a teaching role gives way to a project that shows the job's stack).
  const projects = pool.projects ?? [];
  if (rk.projectScore) {
    const ps = rk.projectScore;
    const live = projects.map((_, i) => i).filter((i) => !off.has(`P:${i}`)).sort((a, b) => ps[a] - ps[b] || b - a);
    const weakRole = droppableRole(pool, off, rk);
    if (weakRole !== undefined && live.length && rk.entryScore[weakRole] < ps[live[0]]) return `X:${weakRole}`;
    // A role's bullet that shows clearly less of this job than the weakest project still shown
    // goes before that project (a frontend bullet gives way to a project built on the payments stack).
    if (live.length && rk.relevance && rk.projectRelevance) {
      const weak = weakBullet(pool, off, rk.relevance, rk.score, rk.projectRelevance[live[0]] - PROJECT_MARGIN);
      if (weak) return weak;
    }
    // The least relevant project goes first: its second bullet, then the project.
    if (live.length) {
      const vis = projects[live[0]].bullets.map((_, j) => j).filter((j) => !off.has(`p:${live[0]}:${j}`));
      return vis.length > 1 ? `p:${live[0]}:${vis[vis.length - 1]}` : `P:${live[0]}`;
    }
  }
  for (let i = projects.length - 1; i >= 0; i--) {
    if (off.has(`P:${i}`)) continue;
    const vis = projects[i].bullets.map((_, j) => j).filter((j) => !off.has(`p:${i}:${j}`));
    if (vis.length > 1) return `p:${i}:${vis[vis.length - 1]}`;
  }
  for (let i = projects.length - 1; i >= 0; i--) if (!off.has(`P:${i}`)) return `P:${i}`;

  // 2. Bullets beyond each role's aim, least relevant first.
  const aboveTarget = bulletCut(pool, off, rk, (i) => rk.target[i]);
  if (aboveTarget) return aboveTarget;

  // 3. A fourth role: the least relevant one goes whole, never the most recent (her rule: always
  //    keep the most recent real production role), rather than squeezing every role to 2 bullets.
  const drop = droppableRole(pool, off, rk);
  if (drop !== undefined) return `X:${drop}`;

  // 4. Bullets down to two per role. Skills, education and the header are never cut.
  return bulletCut(pool, off, rk, () => MIN_BULLETS_PER_ENTRY);
}

/** The least relevant role that may go whole: only beyond MIN_ROLES, and never the first (most recent). */
function droppableRole(pool: ResumeDoc, off: Set<Key>, rk: Ranking): number | undefined {
  const shown = pool.experience.map((_, i) => i).filter((i) => !off.has(`X:${i}`));
  if (shown.length <= MIN_ROLES) return undefined;
  return shown.filter((i) => i !== 0).sort((a, b) => rk.entryScore[a] - rk.entryScore[b] || b - a)[0];
}

/** A piece only shows when its role is shown: restoring a bullet of a role that's off does nothing. */
const parentShown = (key: Key, off: Set<Key>) =>
  key.startsWith("x:") ? !off.has(`X:${key.split(":")[1]}`) : key.startsWith("p:") ? !off.has(`P:${key.split(":")[1]}`) : true;

/**
 * Trims `pool` to one page, then fills the page back up. `measure` gives the content height as a
 * share of the usable page; anything at or under `limit` fits.
 */
export function fitToPage(pool: ResumeDoc, measure: MeasureFn, opts: FitOptions = {}): FitResult {
  const limit = opts.limit ?? FIT_LIMIT;
  const fillTarget = opts.fillTarget ?? FILL_TARGET;
  const maxSteps = opts.maxSteps ?? 80;
  const rk = rank(pool, opts);
  const off = new Set<Key>();
  const cut: Key[] = [];

  let fill = measure(build(pool, off).doc);
  for (let step = 0; step < maxSteps && fill > limit; step++) {
    const key = nextCut(pool, off, rk);
    if (!key) break;
    off.add(key);
    cut.push(key);
    fill = measure(build(pool, off).doc);
  }
  const fits = fill <= limit;

  // Fill: the last cut usually freed more room than it had to. Try everything trimmed, most
  // valuable first (the reverse of the cut order), and keep each piece that still fits.
  const restored: Key[] = [];
  const cap = opts.maxBulletsPerRole ?? Infinity;
  if (fits && opts.restore !== false) {
    for (const key of [...cut].reverse()) {
      if (!parentShown(key, off)) continue;
      if (key.startsWith("x:") && visibleBullets(pool, off, Number(key.split(":")[1])).length >= cap) continue;
      off.delete(key);
      const next = measure(build(pool, off).doc);
      if (next <= limit) {
        fill = next;
        restored.push(key);
      } else {
        off.add(key);
      }
    }
  }

  const { doc, map } = build(pool, off);
  const leftOff = cut.filter((k) => off.has(k));
  const leftOffEntries = leftOff.flatMap((k): FitResult["leftOffEntries"] => {
    const [kind, a] = k.split(":");
    const e = kind === "X" ? pool.experience[Number(a)] : kind === "P" ? pool.projects?.[Number(a)] : undefined;
    return e ? [{ kind: kind === "X" ? "role" : "project", title: e.title, company: e.company }] : [];
  });
  return {
    leftOffEntries,
    doc,
    removed: leftOff.map((k) => describe(pool, k)),
    restored: restored.map((k) => describe(pool, k)),
    fits,
    fill,
    underfilled: fits && fill < fillTarget,
    map,
  };
}

/** A spot on the visible page, translated to the same spot in the pool (null if it isn't shown). */
export function toPoolTarget(map: PoolMap, t: Target): Target | null {
  if (t.section === "skills") return map.skills[t.entry] === undefined ? null : { section: "skills", entry: map.skills[t.entry] };
  if (t.section === "leadership") return map.leadership[t.entry] === undefined ? null : { section: "leadership", entry: map.leadership[t.entry] };
  if (t.section === "projects" && !map.projects) return null;
  const e = map[t.section][t.entry];
  if (!e) return null;
  if (t.bullet === undefined) return { section: t.section, entry: e.entry };
  const b = e.bullets[t.bullet];
  return b === undefined ? null : { section: t.section, entry: e.entry, bullet: b };
}

/**
 * The reverse of toPoolTarget: a spot in the pool, translated to the same spot on the visible page,
 * or null when fitting left it off. Used to mark flagged lines in the preview.
 */
export function toVisibleSpot<T extends FlagSpot>(map: PoolMap, t: T): T | null {
  if (t.section === "skills") {
    const line = map.skills.indexOf(t.line);
    return line < 0 ? null : ({ ...t, line } as T);
  }
  if (t.section === "leadership") {
    const entry = map.leadership.indexOf(t.entry);
    return entry < 0 ? null : ({ ...t, entry } as T);
  }
  const entries = map[t.section];
  const entry = entries.findIndex((e) => e.entry === t.entry);
  if (entry < 0) return null;
  if (t.bullet === undefined) return { ...t, entry } as T;
  const bullet = entries[entry].bullets.indexOf(t.bullet);
  return bullet < 0 ? null : ({ ...t, entry, bullet } as T);
}

/** Measures a candidate page at a given layout (fit.ts pageFill reads doc.layout). */
export type LayoutMeasureFn = (doc: ResumeDoc) => number;

export interface ResumeFitResult extends FitResult {
  layout: Layout;
  /** Content height at the default 10pt layout, after any trimming and before the type grows. */
  baseFill: number;
  /** Plain notes on what the loop changed, for the Checks list. */
  steps: string[];
}

const withLayout = (doc: ResumeDoc, layout: Layout): ResumeDoc => ({ ...doc, layout });
const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * The fit loop, deterministic: one US Letter page, FILL_TARGET to FIT_LIMIT full.
 *  - Overflow at the default 10pt: drop the lowest-relevance content first (leadership, extra
 *    project bullets, then bullets of the lowest-ranked roles; metrics last) until it fits.
 *  - Underflow: content first, then type. Put back the most valuable cut content that fits (real
 *    bullets of the highest-ranked roles, at most 5 per role, a coursework line, project bullets,
 *    skills lines, then leadership); only if the page is still short, raise the body font 0.25pt at
 *    a time up to 11pt, then line and section spacing up to 1.15.
 * Projects are capped at 2 bullets. `measure` must honor doc.layout.
 */
export function fitResume(pool: ResumeDoc, measure: LayoutMeasureFn, opts: Omit<FitOptions, "restore" | "maxBulletsPerRole"> = {}): ResumeFitResult {
  const limit = opts.limit ?? FIT_LIMIT;
  const fillTarget = opts.fillTarget ?? FILL_TARGET;
  const capped: ResumeDoc = pool.projects ? { ...pool, projects: pool.projects.map((p) => ({ ...p, bullets: p.bullets.slice(0, MAX_PROJECT_BULLETS) })) } : pool;
  const steps: string[] = [];
  let layout: Layout = { ...DEFAULT_LAYOUT };
  const at = (l: Layout) => (d: ResumeDoc) => measure(withLayout(d, l));

  // Trim to fit at the default type, then put back whatever fits, most valuable first.
  let r = fitToPage(capped, at(layout), { ...opts, limit, fillTarget, maxBulletsPerRole: MAX_RESTORED_BULLETS });
  const baseFill = r.fill;
  if (!r.fits) return { ...r, doc: withLayout(r.doc, layout), layout, baseFill, steps };

  const grow = (next: (l: Layout) => Layout | null, label: (l: Layout) => string) => {
    let changed = false;
    for (let guard = 0; guard < 20 && r.fill < fillTarget; guard++) {
      const candidate = next(layout);
      if (!candidate) break;
      const f = measure(withLayout(r.doc, candidate));
      if (f > limit) break;
      layout = candidate;
      r = { ...r, fill: f, underfilled: f < fillTarget };
      changed = true;
    }
    if (changed) steps.push(label(layout));
  };
  // Content is all in and the page is still short: larger type, then more spacing.
  grow((l) => (l.body < MAX_BODY_PT ? { ...l, body: Math.min(MAX_BODY_PT, round2(l.body + BODY_STEP_PT)) } : null), (l) => `Body text set to ${l.body}pt to fill the page.`);
  grow((l) => (l.spacing < MAX_SPACING ? { ...l, spacing: Math.min(MAX_SPACING, round2(l.spacing + SPACING_STEP)) } : null), (l) => `Line spacing set to ${l.spacing} to fill the page.`);

  return { ...r, doc: withLayout(r.doc, layout), layout, baseFill, underfilled: r.fits && r.fill < fillTarget, steps };
}
