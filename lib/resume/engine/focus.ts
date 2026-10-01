import { normalizeRoleType } from "../../eligibility/roles";
import { altTitle, cleanTitle } from "../master/experiences";
import { hasSkill } from "../master/skills";
import type { RoleType } from "../../types";

// What this particular job is about, read by code from the posting (decision #7: the ranking is
// plain TypeScript, not the model): its role family, the domains its own text dwells on
// (payments, accessibility, distributed systems...), its top responsibilities, and its must-have
// and nice-to-have skills in the posting's spelling. Every place that chooses content (the fit
// step, the page filler, the skills lines, the prompt) ranks with the same focus, so a payments
// job and a frontend job get visibly different pages from the same experience.
//
// Everything here is pure and explainable: a bullet's relevance is a sum of named parts.

export interface Domain {
  id: string;
  /** Plain words for the "Tailored for this job" summary. */
  label: string;
  /** Whole-word patterns (case-insensitive) that show the domain in a posting or a bullet. */
  terms: string[];
}

export const DOMAINS: Domain[] = [
  { id: "payments", label: "payments", terms: ["payments?", "payouts?", "billing", "refunds?", "checkout", "fintech", "ledgers?", "transactions?", "invoic\\w*", "idempoten\\w*", "merchants?"] },
  { id: "healthcare", label: "healthcare", terms: ["patients?", "clinics?", "clinical", "health ?care", "medical", "hipaa"] },
  { id: "accessibility", label: "accessibility", terms: ["accessib\\w*", "wcag", "a11y", "screen readers?", "keyboard (?:support|navigation)", "aria"] },
  { id: "frontend", label: "front end", terms: ["front[- ]?end", "ui", "user interfaces?", "web apps?", "components?", "browsers?", "bundle", "css", "date pickers?"] },
  { id: "reliability", label: "reliability", terms: ["reliab\\w*", "observab\\w*", "monitoring", "traces", "tracing", "dashboards?", "latency", "uptime", "incidents?", "on-call", "retries"] },
  { id: "distributed", label: "distributed systems", terms: ["distributed", "replication", "consensus", "key-value", "storage", "control plane", "clusters?", "nodes", "scalab\\w*", "throughput"] },
  { id: "data", label: "data pipelines", terms: ["pipelines?", "analytics", "etl", "data warehous\\w*", "warehousing", "data platform", "datasets?", "batch", "streaming", "queries", "sql"] },
  { id: "ml", label: "machine learning", terms: ["machine learning", "ml", "models?", "training", "ranking", "inference", "neural", "embeddings?", "llms?"] },
  { id: "cloud", label: "cloud infrastructure", terms: ["cloud", "infrastructure", "serverless", "aws", "lambda", "kubernetes", "containers?", "terraform", "deploy\\w*", "docker"] },
  { id: "testing", label: "testing", terms: ["tests?", "testing", "test coverage", "coverage", "qa", "test suites?"] },
  { id: "systems", label: "systems and embedded", terms: ["linux", "kernel", "ebpf", "low[- ]level", "firmware", "embedded", "robots?", "robotics", "hardware", "real[- ]time", "profil\\w*", "lock contention", "benchmark\\w*"] },
  { id: "backend", label: "backend services", terms: ["apis?", "services?", "backend", "back[- ]end", "endpoints?", "microservices?", "schemas?", "databases?"] },
  { id: "mobile", label: "mobile", terms: ["ios", "android", "mobile", "app store"] },
  { id: "security", label: "security", terms: ["security", "secure", "authentication", "encryption", "vulnerabilit\\w*"] },
  { id: "design", label: "design", terms: ["user research", "usability", "designers?", "prototyp\\w*", "figma", "ux"] },
];

const domainRe = new Map(DOMAINS.map((d) => [d.id, new RegExp(`(^|[^a-z0-9])(?:${d.terms.join("|")})(?![a-z0-9])`, "i")]));

/** Whether a piece of text shows this domain. */
export const showsDomain = (text: string, id: string) => domainRe.get(id)?.test(text.replace(/\*\*/g, "")) ?? false;

export interface JobFocus {
  role: string;
  /** The role family of the job title (lib/eligibility/roles.ts). */
  family: RoleType;
  /** Must-have skills, in the posting's spelling, most important first. */
  must: string[];
  nice: string[];
  /** The domains the job's own text is about, strongest first, with how strongly (2 = one specific mention). */
  domains: { id: string; label: string; weight: number }[];
  /** Up to 4 job-specific responsibility sentences. */
  responsibilities: string[];
  /** Content words (stemmed) of those responsibilities, for overlap with a bullet. */
  terms: string[];
}

export interface FocusInput {
  role: string;
  jdText: string;
  must: string[];
  nice?: string[];
}

/** How much a posting section says about this job (0: boilerplate about benefits or the company). */
function sectionWeight(heading: string): number | null {
  const h = heading.toLowerCase();
  if (/benefit|perks|compensation|about (us|the company)|equal opportunity|why join|our values|\beeo\b|who we are/.test(h)) return 0;
  if (/about (the |this )?(role|team|job|position)|what you('|’)ll (do|work on)|the role|overview|your impact|in this role|the team/.test(h)) return 2;
  if (/responsibilit|what you will|duties|day to day/.test(h)) return 1.5;
  if (/qualification|requirement|what you('|’)ll bring|who you are|skills|nice to have|preferred|bonus|minimum|basic/.test(h)) return 1;
  return null;
}

const isHeading = (line: string) => line.length <= 48 && !/[.:;,]$/.test(line) && !/^[-*•]/.test(line) && sectionWeight(line) !== null;

/**
 * Lines nearly every posting has (code review, docs, on-call, cross-functional work, degree,
 * fundamentals, soft skills): they say nothing about what this team builds, so they don't count.
 */
const GENERIC_LINE =
  /on-?call rotation|review code|code reviews?|documentation|product managers? and designers|cross-functional|data structures(,| and) algorithms|communication|bachelor|degree|equivalent (practical )?experience|equal opportunity|without regard|salary|equity|insurance|401\(k\)|time off|curiosity|passion|small team|ramped up/i;

interface WeightedLine {
  text: string;
  weight: number;
}

/** The posting split into lines, each with how much it speaks about this job's own work. */
export function weightedLines(jdText: string): WeightedLine[] {
  const out: WeightedLine[] = [];
  let weight = 1;
  for (const raw of jdText.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (isHeading(line)) {
      weight = sectionWeight(line) ?? weight;
      continue;
    }
    out.push({ text: line, weight: GENERIC_LINE.test(line) ? 0 : weight });
  }
  return out;
}

const STOP = new Set(
  "a an and the to of for with in on at by from into using use used via as or that this its their our your you you'll we will end is are be be on own across every day new such like other more each".split(" "),
);
/** Words every software posting uses: they don't say what this job is about. */
const GENERIC_WORDS = new Set(
  "build built building work team teams feature features ship shipped design designed help write code software engineer engineering engineers product products company role job experience systems system strong great years plus nice have required requirements interest".split(
    " ",
  ),
);

/** "services" -> "servic", "building" -> "build": close enough to match a bullet's wording. */
export const stem = (w: string) => w.toLowerCase().replace(/(ing|ed|es|s)$/, (m) => (w.length > 4 ? "" : m));

export function contentWords(text: string): string[] {
  return text
    .replace(/\*\*/g, "")
    .toLowerCase()
    .split(/[^a-z0-9+#]+/)
    .filter((w) => w.length > 2 && !STOP.has(w) && !GENERIC_WORDS.has(w))
    .map(stem);
}

const ACTION =
  /^(?:you('|’)ll |you will )?(build|design|own|write|ship|train|work|develop|maintain|partner|deploy|analy[sz]e|test|create|implement|improve|scale|operate|lead|collaborate|integrate|run|automate|instrument|debug|optimi[sz]e|architect)\b/i;

/** Up to 4 sentences from the posting that say what the job does, boilerplate left out. */
export function topResponsibilities(jdText: string): string[] {
  const out: string[] = [];
  for (const { text, weight } of weightedLines(jdText)) {
    if (weight < 1.5) continue;
    for (const s of text.replace(/^[-*•]\s*/, "").split(/(?<=[.!?])\s+/)) {
      const sentence = s.replace(/^(what you('|’)ll do|responsibilities|the role)\s*:\s*/i, "").trim();
      if (!ACTION.test(sentence) || sentence.length < 15) continue;
      if (!out.includes(sentence)) out.push(sentence);
      if (out.length >= 4) return out;
    }
  }
  return out;
}

/** Title lines weigh most: "Software Engineer, New Grad (Payments Platform)" is about payments. */
const TITLE_WEIGHT = 3;
const MIN_DOMAIN_WEIGHT = 2;
const MAX_DOMAINS = 4;

export function buildJobFocus(input: FocusInput): JobFocus {
  const lines = [{ text: input.role, weight: TITLE_WEIGHT }, ...weightedLines(input.jdText)];
  const domains = DOMAINS.map((d) => ({
    id: d.id,
    label: d.label,
    weight: lines.filter((l) => l.weight > 0 && showsDomain(l.text, d.id)).reduce((s, l) => s + l.weight, 0),
  }))
    .filter((d) => d.weight >= MIN_DOMAIN_WEIGHT)
    .sort((a, b) => b.weight - a.weight)
    .slice(0, MAX_DOMAINS);
  const responsibilities = topResponsibilities(input.jdText);
  const must = dedupe(input.must);
  const nice = dedupe(input.nice ?? []).filter((n) => !must.some((m) => m.toLowerCase() === n.toLowerCase()));
  return {
    role: input.role,
    family: normalizeRoleType(input.role),
    must,
    nice,
    domains,
    responsibilities,
    terms: [...new Set(responsibilities.flatMap(contentWords))],
  };
}

const dedupe = (xs: string[]) => {
  const seen = new Set<string>();
  return xs.map((x) => x.trim()).filter((x) => x && !seen.has(x.toLowerCase()) && seen.add(x.toLowerCase()));
};

// A bullet's relevance, in "skill hit" units (a must-have skill = 1), so it slots into the fit
// step's existing weights (relevance.ts bulletScore).
const MUST = 1;
const NICE = 0.5;
const DOMAIN = 0.6;
const TERM = 0.25;
const MAX_TERMS = 3;

export interface RelevanceParts {
  must: string[];
  nice: string[];
  domains: string[];
  terms: number;
  score: number;
}

/** Why a piece of text matters to this job, part by part. */
export function relevanceParts(focus: JobFocus, text: string): RelevanceParts {
  const plainText = text.replace(/\*\*/g, "");
  const must = focus.must.filter((s) => hasSkill(s, [], plainText));
  const nice = focus.nice.filter((s) => hasSkill(s, [], plainText));
  // The strongest domain counts fully, later ones a bit less.
  const domains = focus.domains.filter((d) => showsDomain(plainText, d.id));
  const domainScore = focus.domains.reduce((s, d, i) => s + (showsDomain(plainText, d.id) ? DOMAIN * (1 - i * 0.2) : 0), 0);
  const words = new Set(contentWords(plainText));
  const terms = Math.min(MAX_TERMS, focus.terms.filter((t) => words.has(t)).length);
  return {
    must,
    nice,
    domains: domains.map((d) => d.label),
    terms,
    score: MUST * must.length + NICE * nice.length + domainScore + TERM * terms,
  };
}

export const focusRelevance = (focus: JobFocus) => (text: string) => relevanceParts(focus, text).score;

// --- Roles ----------------------------------------------------------------------------------

const MONTHS = "jan feb mar apr may jun jul aug sep oct nov dec".split(" ");

/** The end of a date range as months since year 0 ("Present" = `now`), or null if unreadable. */
export function endMonth(dates: string, now = new Date()): number | null {
  const parts = dates.split(/\s+-\s+|\s+to\s+/i);
  const end = parts[parts.length - 1].trim().toLowerCase();
  if (/present|current|now/.test(end)) return now.getFullYear() * 12 + now.getMonth();
  const y = end.match(/(19|20)\d{2}/);
  if (!y) return null;
  const m = MONTHS.findIndex((mo) => end.startsWith(mo) || end.includes(` ${mo}`));
  return Number(y[0]) * 12 + Math.max(0, m);
}

/** A role's family from its title. Teaching and tutoring aren't the family their subject names. */
export function titleFamily(title: string): RoleType {
  if (/\b(teach|tutor|instructor|grader|mentor)/i.test(title)) return "Other";
  return normalizeRoleType(cleanTitle(title));
}

const ENGINEERING = new Set<RoleType>(["Software Engineering", "Frontend/Web", "Mobile", "DevOps / SRE / Cloud", "Embedded / Hardware", "AI / ML", "Data & Analytics"]);

/** Bonus for a role whose own title is this job's kind of work: 1 for the same family, 0.25 for a related one. */
export function familyBonus(focus: JobFocus, title: string): number {
  if (focus.family === "Other") return 0;
  const fam = titleFamily(title);
  if (fam === focus.family) return 1;
  return ENGINEERING.has(fam) && ENGINEERING.has(focus.family) ? 0.25 : 0;
}

/**
 * Of a role's two titles (main and "alt. title"), the one whose family is this job's, or the main
 * title. Both are hers (rule 6), so this only chooses.
 */
export function preferredTitle(title: string, focus: JobFocus): string {
  const alt = altTitle(title);
  const main = cleanTitle(title);
  if (!alt) return main;
  return familyBonus(focus, alt) > familyBonus(focus, main) ? alt : main;
}

export interface EntryLike {
  title: string;
  company: string;
  dates: string;
  bullets: string[];
}

/**
 * How relevant a whole role or project is: the mean of its two most relevant bullets, plus its
 * title's family, plus a little for recency (up to 0.5 for the most recent of `all`).
 */
export function entryRelevance(focus: JobFocus, e: EntryLike, all: EntryLike[] = [e], now = new Date()): number {
  const scores = e.bullets.map((b) => relevanceParts(focus, b).score).sort((a, b) => b - a);
  const top = scores.slice(0, 2);
  const mean = top.length ? top.reduce((a, b) => a + b, 0) / top.length : 0;
  const ends = all.map((x) => endMonth(x.dates, now)).filter((x): x is number => x !== null);
  const mine = endMonth(e.dates, now);
  const latest = ends.length ? Math.max(...ends) : null;
  // A role that ended a year before the latest gets 0.25, two years before none.
  const recency = mine !== null && latest !== null ? Math.max(0, 0.5 - (latest - mine) / 48) : 0;
  return mean + familyBonus(focus, e.title) + recency - teachingPenalty(focus, e.title);
}

const TEACHING = /\b(teach|tutor|instructor|grader)/i;

/** For an engineering job, teaching a course says less than a job, research or a project that does the work. */
export function teachingPenalty(focus: JobFocus, title: string): number {
  return TEACHING.test(title) && ENGINEERING.has(focus.family) ? 0.5 : 0;
}

/** The skills from `focus` (must first) that a piece of text shows, in the posting's spelling. */
export function focusSkillsIn(focus: JobFocus, text: string): string[] {
  const p = relevanceParts(focus, text);
  return [...p.must, ...p.nice];
}
