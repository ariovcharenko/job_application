import type { Target } from "./edit";
import { BODY_STEP_PT, DEFAULT_LAYOUT, MAX_BODY_PT, MAX_SPACING, PAGE, SPACING_STEP, type Layout } from "./layout";
import { bulletScore, type RelevanceFn } from "./relevance";
import type { ResumeDoc } from "./schema";

// Fits the model's relevance-ranked pool to exactly one page, deterministically.
//
// The model is asked for MORE than fits (prompt.ts): 3 to 4 roles, the most relevant ones with 6
// or 7 bullets, each role's bullets most relevant first. Code then:
//  1. trims the least relevant content until the page fits (her rule 3: "cut the least relevant
//     bullets first, never the metrics"), and
//  2. fills: puts trimmed content back, most valuable first, wherever it still fits, so the page
//     ends near full instead of a quarter page early.
//
// Everything here is pure. The page is measured by a function passed in (fit.ts measures the real
// HTML rendering in the browser; tests pass a fake), so the same pool always gives the same page.

/** Fewest bullets a role keeps before the role itself would go. */
const MIN_BULLETS_PER_ENTRY = 2;
/** Her rule: 5 to 7 skills lines. */
const MIN_SKILL_LINES = 5;
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
  /** Fits, but under FILL_TARGET with nothing left in the pool that fits: ask for more content. */
  underfilled: boolean;
  map: PoolMap;
}

export interface FitOptions {
  /** Job-skill hits for a bullet's plain text (lib/resume/coverage.ts skillHits). */
  relevance?: RelevanceFn;
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
}

function rank(pool: ResumeDoc, relevance?: RelevanceFn): Ranking {
  const score = pool.experience.map((e) => e.bullets.map((b, j) => bulletScore(b, j, e.bullets.length, relevance)));
  // A role's relevance: its three strongest bullets (a role the model gave more bullets to, and
  // whose bullets show more of the job's skills, ranks higher).
  const entryScore = score.map((s) => [...s].sort((a, b) => b - a).slice(0, 3).reduce((a, b) => a + b, 0));
  const order = entryScore.map((v, i) => ({ v, i })).sort((a, b) => b.v - a.v || a.i - b.i);
  const target = new Array<number>(pool.experience.length).fill(TARGET_BY_RANK[TARGET_BY_RANK.length - 1]);
  order.forEach(({ i }, r) => (target[i] = TARGET_BY_RANK[Math.min(r, TARGET_BY_RANK.length - 1)]));
  return { score, target, entryScore };
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

/** The next piece to leave off, least relevant first, or null when nothing more can go. */
function nextCut(pool: ResumeDoc, off: Set<Key>, rk: Ranking): Key | null {
  // 1. Leadership goes first: her rule is "include only if space remains".
  for (let i = pool.leadership.length - 1; i >= 0; i--) if (!off.has(`L:${i}`)) return `L:${i}`;

  // 1b. Project bullets beyond the first, then whole projects (last listed first).
  const projects = pool.projects ?? [];
  for (let i = projects.length - 1; i >= 0; i--) {
    if (off.has(`P:${i}`)) continue;
    const vis = projects[i].bullets.map((_, j) => j).filter((j) => !off.has(`p:${i}:${j}`));
    if (vis.length > 1) return `p:${i}:${vis[vis.length - 1]}`;
  }
  for (let i = projects.length - 1; i >= 0; i--) if (!off.has(`P:${i}`)) return `P:${i}`;

  // 2. Bullets beyond each role's aim, least relevant first.
  const aboveTarget = bulletCut(pool, off, rk, (i) => rk.target[i]);
  if (aboveTarget) return aboveTarget;

  // 3. Education details beyond the first.
  for (let i = pool.education.length - 1; i >= 0; i--) {
    const vis = pool.education[i].bullets.map((_, j) => j).filter((j) => !off.has(`e:${i}:${j}`));
    if (vis.length > 1) return `e:${i}:${vis[vis.length - 1]}`;
  }

  // 4. A fourth role: the least relevant one goes whole, never the most recent (her rule: always
  //    keep the most recent real production role), rather than squeezing every role to 2 bullets.
  const shown = pool.experience.map((_, i) => i).filter((i) => !off.has(`X:${i}`));
  if (shown.length > MIN_ROLES) {
    const drop = shown.filter((i) => i !== 0).sort((a, b) => rk.entryScore[a] - rk.entryScore[b] || b - a)[0];
    if (drop !== undefined) return `X:${drop}`;
  }

  // 5. Bullets down to two per role.
  const belowTarget = bulletCut(pool, off, rk, () => MIN_BULLETS_PER_ENTRY);
  if (belowTarget) return belowTarget;

  // 6. The remaining education detail lines.
  for (let i = pool.education.length - 1; i >= 0; i--) {
    const vis = pool.education[i].bullets.map((_, j) => j).filter((j) => !off.has(`e:${i}:${j}`));
    if (vis.length > 0) return `e:${i}:${vis[vis.length - 1]}`;
  }

  // 7. Skills lines beyond five.
  const lines = pool.skills.map((_, i) => i).filter((i) => !off.has(`S:${i}`));
  if (lines.length > MIN_SKILL_LINES) return `S:${lines[lines.length - 1]}`;
  return null;
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
  const rk = rank(pool, opts.relevance);
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
  return {
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

/** Measures a candidate page at a given layout (fit.ts pageFill reads doc.layout). */
export type LayoutMeasureFn = (doc: ResumeDoc) => number;

export interface ResumeFitResult extends FitResult {
  layout: Layout;
  /** Plain notes on what the loop changed, for the Checks list. */
  steps: string[];
}

const withLayout = (doc: ResumeDoc, layout: Layout): ResumeDoc => ({ ...doc, layout });
const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Her fit loop, deterministic: one US Letter page, FILL_TARGET to FIT_LIMIT full.
 *  - Over the limit at the smallest type (10pt, single spacing): drop the least relevant content
 *    (leadership, extra project bullets, then bullets by relevance; fitToPage).
 *  - Under the target: (a) raise the body font 0.25pt at a time up to 11pt, (b) raise line and
 *    section spacing up to 1.15, (c) restore the next most relevant bullets (at most 5 per role),
 *    (d) add back Projects and Leadership & Involvement. Each step is kept only if the page still fits.
 * Projects are capped at 2 bullets. `measure` must honor doc.layout.
 */
export function fitResume(pool: ResumeDoc, measure: LayoutMeasureFn, opts: Omit<FitOptions, "restore" | "maxBulletsPerRole"> = {}): ResumeFitResult {
  const limit = opts.limit ?? FIT_LIMIT;
  const fillTarget = opts.fillTarget ?? FILL_TARGET;
  const capped: ResumeDoc = pool.projects ? { ...pool, projects: pool.projects.map((p) => ({ ...p, bullets: p.bullets.slice(0, MAX_PROJECT_BULLETS) })) } : pool;
  const steps: string[] = [];
  let layout: Layout = { ...DEFAULT_LAYOUT };
  const at = (l: Layout) => (d: ResumeDoc) => measure(withLayout(d, l));

  // Trim to fit at the smallest type, without putting anything back yet.
  let r = fitToPage(capped, at(layout), { ...opts, limit, fillTarget, restore: false });
  if (!r.fits) return { ...r, doc: withLayout(r.doc, layout), layout, steps };

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
  // (a) body font, (b) spacing.
  grow((l) => (l.body < MAX_BODY_PT ? { ...l, body: Math.min(MAX_BODY_PT, round2(l.body + BODY_STEP_PT)) } : null), (l) => `Body text set to ${l.body}pt to fill the page.`);
  grow((l) => (l.spacing < MAX_SPACING ? { ...l, spacing: Math.min(MAX_SPACING, round2(l.spacing + SPACING_STEP)) } : null), (l) => `Line spacing set to ${l.spacing} to fill the page.`);

  // (c) bullets, at most 5 per role, then (d) projects and leadership: the cut list put back in
  // reverse (most valuable first), keeping each piece that still fits.
  if (r.fill < fillTarget) {
    const restored = fitToPage(capped, at(layout), { ...opts, limit, fillTarget, maxBulletsPerRole: MAX_RESTORED_BULLETS });
    if (restored.fits) r = restored;
  }
  return { ...r, doc: withLayout(r.doc, layout), layout, underfilled: r.fits && r.fill < fillTarget, steps };
}
