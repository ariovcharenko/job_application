// Turns the skills a posting lists (as the AI extracted them, quirks and all) into a clean list,
// then decides for each skill whether she has it and where she used it. Plain string logic, no AI
// (decision #7): the AI only extracts, the numbers come from here.
//
// Two layers on purpose:
//  - cleanSkillList: normalization of the job's list (split "Python/Java", drop degrees, years,
//    soft skills and filler, keep "Java or Go" as one either-or item, keep a category such as
//    "Cloud platforms (AWS, GCP)" as one any-of item).
//  - matchSkills: have/gap for the cleaned list, with the place each "have" was found. The strict
//    hasSkill (skills.ts) is still what the tailoring engine uses to check facts; the any-of and
//    category rules here only apply to a job's list, never to what may be written on a resume.

import { hasSkill, IMPLIED_BY, isSoftSkill, normalizeSkill, SYNONYMS, type SkillMatch } from "./skills";
import { TECH_TERMS } from "./techTerms";

// ---- Vocabulary ----

/**
 * A category a posting names instead of a tool ("modern frameworks", "cloud platforms"). It counts
 * as "have" when she has any member, so a posting is not marked down for a word that names a group.
 * Keys are normalized and lose leading filler words (modern, common, relevant...).
 */
export const CATEGORY_MEMBERS: Record<string, string[]> = {
  "cloud platforms": ["aws", "gcp", "azure"],
  "cloud services": ["aws", "gcp", "azure"],
  "cloud providers": ["aws", "gcp", "azure"],
  "cloud infrastructure": ["aws", "gcp", "azure"],
  "cloud technologies": ["aws", "gcp", "azure"],
  "cloud computing": ["aws", "gcp", "azure"],
  "public cloud": ["aws", "gcp", "azure"],
  databases: ["postgresql", "mysql", "sqlite", "sql server", "mongodb", "dynamodb", "redis", "cassandra", "firestore"],
  "database technologies": ["postgresql", "mysql", "sqlite", "sql server", "mongodb", "dynamodb", "redis", "cassandra", "firestore"],
  "database systems": ["postgresql", "mysql", "sqlite", "sql server", "mongodb", "dynamodb", "redis", "cassandra", "firestore"],
  "sql databases": ["postgresql", "mysql", "sqlite", "sql server"],
  frameworks: ["react", "vue", "angular", "svelte", "next.js", "django", "flask", "fastapi", "spring boot", "express", "rails", ".net"],
  "web frameworks": ["react", "vue", "angular", "svelte", "next.js", "django", "flask", "fastapi", "spring boot", "express", "rails", ".net"],
  "javascript frameworks": ["react", "vue", "angular", "svelte", "next.js"],
  "frontend frameworks": ["react", "vue", "angular", "svelte", "next.js"],
  "front-end frameworks": ["react", "vue", "angular", "svelte", "next.js"],
  "ui frameworks": ["react", "vue", "angular", "svelte", "swiftui", "flutter"],
  "backend frameworks": ["spring boot", "express", "django", "flask", "fastapi", "rails", ".net", "nestjs", "laravel"],
  "mobile frameworks": ["react native", "flutter", "swiftui", "uikit", "jetpack compose"],
  "testing frameworks": ["jest", "junit", "pytest", "testng", "vitest", "mocha", "cypress", "playwright", "selenium"],
  "test frameworks": ["jest", "junit", "pytest", "testng", "vitest", "mocha", "cypress", "playwright", "selenium"],
  "machine learning frameworks": ["pytorch", "tensorflow", "scikit-learn", "jax", "keras", "xgboost"],
  "deep learning frameworks": ["pytorch", "tensorflow", "jax", "keras"],
  "ml frameworks": ["pytorch", "tensorflow", "scikit-learn", "jax", "keras", "xgboost"],
  "programming languages": ["python", "java", "javascript", "typescript", "c++", "c#", "go", "rust", "swift", "kotlin", "ruby", "php", "scala", "c"],
  "scripting languages": ["python", "bash", "javascript", "ruby", "perl", "lua"],
  "big data technologies": ["spark", "hadoop", "kafka", "flink", "databricks"],
  "big data tools": ["spark", "hadoop", "kafka", "flink", "databricks"],
  "message queues": ["kafka", "rabbitmq", "sqs", "pub/sub", "activemq"],
  "messaging systems": ["kafka", "rabbitmq", "sqs", "pub/sub", "activemq"],
  "design tools": ["figma", "sketch", "adobe xd", "framer"],
  "ui design tools": ["figma", "sketch", "adobe xd", "framer"],
  "prototyping tools": ["figma", "framer", "adobe xd"],
  "analytics tools": ["tableau", "power bi", "looker", "amplitude", "mixpanel", "google analytics"],
  "bi tools": ["tableau", "power bi", "looker"],
  "data visualization tools": ["tableau", "power bi", "looker", "matplotlib"],
  "devops tools": ["docker", "kubernetes", "terraform", "jenkins", "github actions", "ansible"],
  "operating systems": ["linux", "windows", "macos"],
};

/** Parts of a "fundamentals" skill she can only show through her coursework. */
const FUNDAMENTALS: Record<string, string[]> = {
  "data structures": ["data structures"],
  algorithms: ["algorithms"],
  "data structures and algorithms": ["data structures", "algorithms"],
  "computer science fundamentals": ["data structures", "algorithms"],
  "cs fundamentals": ["data structures", "algorithms"],
  "operating systems": ["operating systems"],
  "computer networks": ["computer networks"],
  "computer networking": ["computer networks"],
};

const FILLER_PREFIX = /^(?:(?:modern|relevant|common|popular|various|other|major|leading|standard|industry[- ]standard)\s+)+/;

const categoryKey = (phrase: string) => normalizeSkill(phrase).replace(FILLER_PREFIX, "");

/** IMPLIED_BY keys that are one product, not a group: "AWS (EC2, S3)" is just AWS. */
const PRODUCT_KEYS = new Set(["aws", "gcp", "azure", "kubernetes"]);

const isCategory = (phrase: string) => {
  const k = categoryKey(phrase);
  return k in CATEGORY_MEMBERS || (k in IMPLIED_BY && !PRODUCT_KEYS.has(k));
};

let knownSet: Set<string> | null = null;
/** Names we recognize as one skill: common technologies, synonyms and the implied-by table. */
function isKnown(term: string): boolean {
  knownSet ??= new Set([
    ...TECH_TERMS.map(normalizeSkill),
    ...Object.keys(IMPLIED_BY),
    ...Object.values(IMPLIED_BY).flat(),
    ...Object.keys(SYNONYMS),
    ...Object.values(SYNONYMS),
  ]);
  return knownSet.has(normalizeSkill(term));
}

// ---- Cleaning the job's list ----

const ADJ = "(?:strong|solid|good|deep|proven|demonstrated|demonstrable|hands[- ]on|working|practical|basic|some|prior|professional|relevant|excellent|advanced|extensive|intermediate|fluent|expert)";
const NOUN = "(?:experience|proficiency|proficient|expertise|expert|knowledge|familiarity|familiar|understanding|skills?|background|exposure|competency|command)";
const LEAD_IN = new RegExp(`^(?:(?:${ADJ})\\s+)*${NOUN}\\s+(?:with|in|of|using|on|at|around)\\s+`, "i");
const LEAD_ADJ = new RegExp(`^(?:(?:${ADJ})\\s+)+(?=\\S)`, "i");
const TRAILING = /\s+(?:experience|proficiency|knowledge|skills?|expertise|background)$/i;
const TOOL_WORDS = /\s+(?:tools?|frameworks?|technologies|platforms?|software|libraries)$/i;
const YEARS = /\b\d{1,2}\s*(?:\+|-\s*\d{1,2}\+?|to\s+\d{1,2})?\s*\+?\s*years?\b(?:\s+of)?(?:\s+(?:professional|relevant|industry|hands[- ]on|work(?:ing)?|related|practical|software|engineering|commercial|real[- ]world))*(?:\s+experience)?(?:\s+(?:with|in|using|of|building|developing))?\s*/gi;
const DEGREE = /\b(?:bachelor'?s?|master'?s|masters|ph\.?d|doctorate|doctoral|associate'?s|undergraduate|degree|diploma|bsc|msc|bs\/ms)\b/i;
const FIELD_WORDS = new Set([
  "computer science", "cs", "computer engineering", "software engineering", "electrical engineering", "engineering",
  "information technology", "it", "mathematics", "math", "related field", "related technical field", "a related field",
  "similar field", "stem", "technical field", "related discipline", "a related discipline", "equivalent experience",
  "equivalent practical experience", "equivalent",
]);
const FILLER_ITEM = /^(?:software (?:development|engineering)|programming|coding|technical skills?|best practices|software|development|technology|technologies|modern technologies|emerging technologies|tools|experience|skills?|knowledge|portfolio\b.*|equivalent (?:practical )?experience|related experience|full[- ]time|(?:ability|willingness|eagerness|desire|passion|commitment)\b.*)$/i;
/** Names that look like a slash pair but are one thing. */
const NO_SPLIT = /^(?:ci\/cd|a\/b[a-z ]*|tcp\/ip|i\/o|ui\/ux|ux\/ui|pl\/sql|and\/or|n\/a|client\/server|pub\/sub)$/i;

const wordCount = (s: string) => s.split(/\s+/).filter(Boolean).length;

/** Splits on a one-character separator that is not inside parentheses. */
function splitOutside(s: string, sep: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of s) {
    if (ch === "(") depth++;
    if (ch === ")") depth = Math.max(0, depth - 1);
    if (ch === sep && depth === 0) {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out.map((p) => p.trim()).filter(Boolean);
}

function isFieldOnly(t: string): boolean {
  const parts = t.toLowerCase().split(/,|\/|&|\bor\b|\band\b/).map((p) => p.trim()).filter(Boolean);
  return parts.length > 0 && parts.every((p) => FIELD_WORDS.has(p));
}

/** One finished item: version numbers and tool-words trimmed when what is left is a known name. */
function finish(t: string): string[] {
  let out = t.trim();
  const ver = out.match(/^(.+?)\s+v?\d+(?:\.\d+)*\+?$/);
  if (ver && isKnown(ver[1])) out = ver[1];
  const tw = out.match(TOOL_WORDS);
  if (tw && !isKnown(out) && isKnown(out.replace(TOOL_WORDS, ""))) out = out.replace(TOOL_WORDS, "");
  if (!out || isSoftSkill(out) || FILLER_ITEM.test(out)) return [];
  return [out];
}

function cleanOne(raw: string): string[] {
  let t = raw.replace(/^[\s•*\-–—·]+/, "").replace(/^(?:and|or|&)\s+/i, "").replace(/[\s.;:]+$/, "").replace(/\s+/g, " ").trim();
  if (!t || isSoftSkill(t)) return [];

  const commaParts = splitOutside(t, ",");
  if (commaParts.length > 1) return commaParts.flatMap(cleanOne);

  t = t.replace(YEARS, " ").replace(/\(\s*\)/g, "").replace(/\s+/g, " ").trim();
  if (/\byears?\b/i.test(t)) return [];
  for (let i = 0; i < 3; i++) {
    const before = t;
    t = t.replace(LEAD_IN, "").replace(LEAD_ADJ, "");
    const trimmed = t.replace(TRAILING, "");
    if (trimmed && trimmed !== t && !isCategory(t)) t = trimmed;
    if (t === before) break;
  }
  t = t.replace(/^[\s•*\-–—·]+/, "").replace(/[\s.;:]+$/, "").trim();
  if (!t || DEGREE.test(t) || isFieldOnly(t) || FILLER_ITEM.test(t) || isSoftSkill(t)) return [];

  // Either-or ("Java or Go"): one item, she has it if she has any alternative.
  if (!t.includes("(") && /\s+or\s+/i.test(t)) {
    const alts = t.split(/\s+or\s+/i).map((a) => a.trim());
    if (alts.length <= 3 && alts.every((a) => a && wordCount(a) <= 3)) {
      const kept = alts.flatMap((a) => finish(a));
      return kept.length ? [kept.join(" or ")] : [];
    }
  }

  // "Python/Java", "HTML/CSS", "C/C++": separate skills. "CI/CD" and "TCP/IP" stay whole.
  const base = t.replace(/\([^)]*\)/g, "").trim();
  if (t.includes("/") && !NO_SPLIT.test(base) && !isKnown(base)) {
    const parts = splitOutside(t, "/");
    if (parts.length > 1 && parts.every((p) => wordCount(p) <= 3)) return parts.flatMap(cleanOne);
  }

  // "React and Redux": split only when both sides are names we know ("Data structures and algorithms" is one skill).
  if (!t.includes("(")) {
    const sides = t.split(/\s+(?:and|&)\s+/i);
    if (sides.length === 2 && !isKnown(t) && sides.every((s) => isKnown(s))) return sides.flatMap(cleanOne);
  }

  // "Outer (examples)": a category keeps its examples (any of them counts); anything else is
  // just the outer name ("AWS (EC2, S3)" -> AWS, "Kubernetes (K8s)" -> Kubernetes).
  const paren = t.match(/^(.*?)\s*\((.*)\)$/);
  if (paren && paren[1].trim()) {
    const outer = paren[1].trim();
    if (!isCategory(outer)) return cleanOne(outer);
    const inner = paren[2].replace(/^(?:e\.g\.?,?|i\.e\.?,?|such as|like|including|incl\.?)\s*/i, "");
    const members = splitOutside(inner, ",").map((m) => m.trim()).filter(Boolean);
    const same = members.length === 1 && normalizeSkill(members[0]) === normalizeSkill(outer);
    return members.length && !same ? [`${outer} (${members.join(", ")})`] : finish(outer);
  }

  return finish(t);
}

/** Longest list we score: a posting listing more than this is padding, and each skill would count for almost nothing. */
export const MAX_REQUIRED_SKILLS = 20;
export const MAX_PREFERRED_SKILLS = 10;

/**
 * The job's skills as a clean list: split, deduplicated (by normalized name, so "Postgres" and
 * "PostgreSQL" are one), without degrees, years of experience, soft skills or filler, in the
 * order the posting gave them. Idempotent: cleaning a clean list changes nothing.
 */
export function cleanSkillList(raw: string[], kind?: "required" | "preferred"): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of raw.flatMap(cleanOne)) {
    const k = normalizeSkill(item);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(item);
  }
  return out.slice(0, kind === "preferred" ? MAX_PREFERRED_SKILLS : MAX_REQUIRED_SKILLS);
}

// ---- Where she has it ----

interface Entry {
  label: string;
  text: string;
}

/** "**Software Engineer Intern | Brightloop | Austin, TX | May 2026 - Aug 2026**" -> "Brightloop (Software Engineer Intern)". */
function entryLabel(header: string): string {
  const segs = header.replace(/\*\*/g, "").split("|").map((s) => s.trim());
  const title = segs[0].replace(/\s*\([^)]*\)\s*/g, " ").trim();
  return segs.length >= 4 ? `${segs[1]} (${title})` : title;
}

/** Roles and projects of the master profile, each with its own text. Empty for a profile with no headings. */
function entriesOf(master: string): Entry[] {
  const entries: Entry[] = [];
  let inside = false;
  for (const raw of master.split(/\r?\n/)) {
    const line = raw.trim();
    if (/^#{1,6}\s/.test(line)) {
      inside = /experience|project|work history|employment/i.test(line);
      continue;
    }
    if (!inside) continue;
    if (line.startsWith("**") && line.length > 4) entries.push({ label: entryLabel(line), text: "" });
    else if (entries.length) entries[entries.length - 1].text += `${raw}\n`;
  }
  return entries.filter((e) => e.label);
}

/** The coursework line(s) of her education. */
const courseworkOf = (master: string) => master.split(/\r?\n/).filter((l) => /coursework/i.test(l)).join("\n").toLowerCase();

interface Ctx {
  inventory: string[];
  master: string;
  entries: Entry[];
  coursework: string;
}

function baseEvidence(skill: string, c: Ctx): string | null {
  if (hasSkill(skill, c.inventory, c.master)) {
    const entry = c.entries.find((e) => hasSkill(skill, [], e.text));
    return entry ? entry.label : c.master.trim() && /^#{1,6}\s/m.test(c.master) ? "Skills list" : "Your resume";
  }
  const parts = FUNDAMENTALS[normalizeSkill(skill)];
  if (parts && parts.every((p) => c.coursework.includes(p))) return "Education coursework";
  return null;
}

function evidenceFor(skill: string, c: Ctx): string | null {
  const t = skill.trim();
  if (!t.includes("(") && /\s+or\s+/i.test(t)) {
    for (const alt of t.split(/\s+or\s+/i)) {
      const e = evidenceFor(alt, c);
      if (e) return e;
    }
    return null;
  }
  const paren = t.match(/^(.*?)\s*\((.*)\)$/);
  if (paren && paren[1].trim()) {
    const e = evidenceFor(paren[1], c);
    if (e) return e;
    for (const m of splitOutside(paren[2], ",")) {
      const me = evidenceFor(m, c);
      if (me) return me;
    }
    return null;
  }
  const members = CATEGORY_MEMBERS[categoryKey(t)];
  if (members) {
    for (const m of members) {
      const e = baseEvidence(m, c);
      if (e) return e;
    }
    return null;
  }
  return baseEvidence(t, c);
}

/**
 * Cleans the job's skills and splits them into ones she has and ones she doesn't, noting where
 * each "have" was found. `kind` only sets how long the list may be.
 */
export function matchSkills(jobSkills: string[], inventory: string[], masterText: string, opts: { kind?: "required" | "preferred" } = {}): SkillMatch {
  const ctx: Ctx = { inventory, master: masterText, entries: entriesOf(masterText), coursework: courseworkOf(masterText) };
  const have: string[] = [];
  const gap: string[] = [];
  const evidence: Record<string, string> = {};
  for (const s of cleanSkillList(jobSkills, opts.kind)) {
    const where = evidenceFor(s, ctx);
    if (where) {
      have.push(s);
      evidence[s] = where;
    } else gap.push(s);
  }
  return { have, gap, ...(have.length ? { evidence } : {}) };
}
