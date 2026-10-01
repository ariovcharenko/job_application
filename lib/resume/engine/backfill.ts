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

/** A page bullet already covers this source bullet when they share most of their content words. */
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
function sourceBullets(entry: MasterEntry): string[] {
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

/**
 * The document with each role's unused source bullets appended (most relevant first by
 * `relevance`, highest first), plus how many were added.
 */
export function backfillFromExperience(
  doc: ResumeDoc,
  master: string,
  relevance: (text: string) => number = () => 0,
): { doc: ResumeDoc; added: number } {
  const entries = parseMasterExperiences(master);
  const inventory = parseSkillInventory(master);
  let added = 0;
  const experience = doc.experience.map((e) => {
    const entry = entryFor(entries, e.company);
    if (!entry) return e;
    const source = sourceBullets(entry);
    const everything = doc.experience.flatMap((x) => x.bullets);
    const unused = source
      .filter((s) => !everything.some((b) => overlap(b, s) >= ALREADY_SAID))
      .sort((a, b) => relevance(b) - relevance(a))
      .map((s) => autoBold(s, inventory, master));
    added += unused.length;
    return unused.length ? { ...e, bullets: [...e.bullets, ...unused] } : e;
  });
  return { doc: { ...doc, experience }, added };
}
