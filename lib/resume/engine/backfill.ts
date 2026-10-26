import { parseMasterExperiences, type MasterEntry } from "../master/experiences";
import { hasSkill, parseSkillInventory } from "../master/skills";
import { mentionsTerm, TECH_TERMS } from "../master/techTerms";
import { metricsIn } from "./relevance";
import type { ResumeDoc } from "./schema";

// When the model's answer is shorter than a page, the rest of the page is filled from her own
// experience, word for word: the bullets of the chosen roles that the page doesn't already say.
// They are true by construction (copied from the source), so this costs nothing and can't invent a
// fact. Added at the end of each role (lowest rank), so fitting keeps them only when there's room.

const STOP = new Set("a an and the to of for with in on at by from into using used via as or that this its their our".split(" "));
const words = (s: string) =>
  new Set(
    s
      .replace(/\*\*/g, "")
      .toLowerCase()
      .split(/[^a-z0-9+#.]+/)
      .filter((w) => w.length > 2 && !STOP.has(w)),
  );

/** Share of the smaller bullet's content words that the other one also has. */
export function overlap(a: string, b: string): number {
  const A = words(a);
  const B = words(b);
  if (A.size === 0 || B.size === 0) return 0;
  let shared = 0;
  for (const w of A) if (B.has(w)) shared++;
  return shared / Math.min(A.size, B.size);
}

/**
 * Share of the source bullet's content words the page bullet also has: "does the page already say
 * this?" Dividing by the smaller bullet instead made every short page bullet "cover" long source
 * bullets that share a few words, so a short page stayed short (live run, 2026-10-25).
 */
export function covers(pageBullet: string, source: string): number {
  const S = words(source);
  const B = words(pageBullet);
  if (S.size === 0) return 1;
  let shared = 0;
  for (const w of S) if (B.has(w)) shared++;
  return shared / S.size;
}

/** A page bullet already covers this source bullet when it has most of its content words. */
export const ALREADY_SAID = 0.5;
const MAX_BOLD = 3;

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Bolds her technologies (up to 3) and the first real metric in a plain source bullet. */
export function autoBold(text: string, inventory: string[], master: string): string {
  const terms = [...new Set([...inventory, ...TECH_TERMS])]
    .filter((t) => t.length > 1 && mentionsTerm(text, t) && hasSkill(t, inventory, master))
    .sort((a, b) => b.length - a.length);
  const picked: string[] = [];
  for (const t of terms) {
    if (picked.length >= MAX_BOLD) break;
    if (picked.some((p) => p.toLowerCase().includes(t.toLowerCase()))) continue;
    picked.push(t);
  }
  let out = text;
  const metric = metricsIn(text)[0];
  if (metric) out = out.replace(metric, `**${metric}**`);
  for (const t of picked) {
    const re = new RegExp(`(^|[^A-Za-z0-9+#.*])(${escapeRe(t)})(?![A-Za-z0-9+#*])`, t.length <= 4 ? "" : "i");
    out = out.replace(re, (_m, pre: string, word: string) => `${pre}**${word}**`);
  }
  return out.replace(/\*\*\*\*/g, "");
}

/** A role's own bullet lines in the master profile, without their "- " markers. */
export function sourceBullets(entry: MasterEntry): string[] {
  return entry.block
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => /^[-*•]\s+/.test(l))
    .map((l) => l.replace(/^[-*•]\s+/, "").trim())
    .filter((l) => l.length > 0);
}

const loose = (s: string) => s.replace(/\*\*/g, "").toLowerCase().replace(/[^a-z0-9%+$]+/g, " ").trim();

/**
 * The experience bullets on `doc` that are her source lines word for word (what the page filler
 * adds), as positions: rewriting them for the job is worth a comment when a revision call is being
 * made anyway.
 */
export function copiedBullets(doc: ResumeDoc, master: string): { entry: number; bullet: number }[] {
  const entries = parseMasterExperiences(master);
  const out: { entry: number; bullet: number }[] = [];
  doc.experience.forEach((e, i) => {
    const entry = entryFor(entries, e.company);
    if (!entry) return;
    const source = new Set(sourceBullets(entry).map(loose));
    e.bullets.forEach((b, j) => {
      if (source.has(loose(b))) out.push({ entry: i, bullet: j });
    });
  });
  return out;
}

function entryFor(entries: MasterEntry[], company: string): MasterEntry | undefined {
  const c = company.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  return entries.find((m) => m.company.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim() === c);
}

/** Most source bullets restored to one role or project, so counts stay even (not 8/5/4/2). */
export const MAX_BACKFILL_PER_ROLE = 4;
/** A role is never filled past this many bullets in total (the model's own count is left alone). */
export const MAX_BULLETS_PER_ROLE = 6;

const plainText = (s: string) => s.replace(/\*\*/g, "");
const hasMetric = (s: string) => metricsIn(s).length > 0;

/**
 * The page's bullets of ONE role already carry this source bullet when either most of its words
 * are there, or every number and tool it names appears together in a single bullet of that role
 * (a merged or reworded bullet that kept the facts). A similar bullet in another role says nothing.
 */
function coveredInRole(pageBullets: string[], source: string): boolean {
  if (pageBullets.some((b) => covers(b, source) >= ALREADY_SAID)) return true;
  const metrics = metricsIn(source);
  const tools = TECH_TERMS.filter((t) => mentionsTerm(source, t));
  if (metrics.length + tools.length === 0) return false;
  return pageBullets.some((b) => {
    const text = plainText(b);
    return metrics.every((m) => text.includes(m)) && tools.every((t) => mentionsTerm(text, t));
  });
}

/**
 * The document with each role's and project's unused source bullets appended, word for word:
 * judged per role, bullets with a metric first and then the most relevant by `relevance` (highest
 * first), at most MAX_BACKFILL_PER_ROLE per entry and MAX_BULLETS_PER_ROLE in all. Also returns how
 * many were added. `limits` overrides both caps and the metrics-first order (the demo builds a deliberately long, purely relevance-ordered pool).
 */
export function backfillFromExperience(
  doc: ResumeDoc,
  master: string,
  relevance: (text: string) => number = () => 0,
  limits: { perRole?: number; total?: number; metricsFirst?: boolean } = {},
): { doc: ResumeDoc; added: number } {
  const entries = parseMasterExperiences(master);
  const inventory = parseSkillInventory(master);
  let added = 0;
  const fill = (e: ResumeDoc["experience"][number]) => {
    const entry = entryFor(entries, e.company);
    if (!entry) return e;
    const room = Math.min(limits.perRole ?? MAX_BACKFILL_PER_ROLE, (limits.total ?? MAX_BULLETS_PER_ROLE) - e.bullets.length);
    if (room <= 0) return e;
    const unused = sourceBullets(entry)
      .filter((src) => !coveredInRole(e.bullets, src))
      .map((src, i) => ({ src, i, metric: hasMetric(src), rel: relevance(src) }))
      .sort((a, b) => (limits.metricsFirst === false ? 0 : Number(b.metric) - Number(a.metric)) || b.rel - a.rel || a.i - b.i)
      .slice(0, room)
      .map((x) => autoBold(x.src, inventory, master));
    added += unused.length;
    return unused.length ? { ...e, bullets: [...e.bullets, ...unused] } : e;
  };
  const experience = doc.experience.map(fill);
  const projects = doc.projects?.map(fill);
  return { doc: { ...doc, experience, ...(projects ? { projects } : {}) }, added };
}
