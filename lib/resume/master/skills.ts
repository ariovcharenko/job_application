// Reads the skills inventory out of the master profile text and matches a job's skills against it.
// Plain string logic, no AI: this is what decides "have" vs "gap" for the qualifications check and
// which skills the tailoring engine may put on the page.

/** Common spellings that mean the same skill. Keys and values are already normalized. */
const SYNONYMS: Record<string, string> = {
  postgres: "postgresql",
  psql: "postgresql",
  js: "javascript",
  ts: "typescript",
  node: "node.js",
  nodejs: "node.js",
  "react.js": "react",
  reactjs: "react",
  "next.js 14": "next.js",
  nextjs: "next.js",
  golang: "go",
  restful: "rest apis",
  "restful apis": "rest apis",
  "restful services": "rest apis",
  "restful web services": "rest apis",
  "rest services": "rest apis",
  "rest api": "rest apis",
  rest: "rest apis",
  "google cloud": "gcp",
  "google cloud platform": "gcp",
  "amazon web services": "aws",
  k8s: "kubernetes",
  "large language models": "llms",
  llm: "llms",
  "html5": "html",
  css3: "css",
  "c plus plus": "c++",
  tailwind: "tailwind css",
  "github actions": "github actions",
  "vue.js": "vue",
  vuejs: "vue",
  // Data and analytics
  powerbi: "power bi",
  "microsoft power bi": "power bi",
  "ms excel": "excel",
  "microsoft excel": "excel",
  "ab testing": "a/b testing",
  "a/b tests": "a/b testing",
  "split testing": "a/b testing",
  // ML
  sklearn: "scikit-learn",
  "scikit learn": "scikit-learn",
  huggingface: "hugging face",
  "hugging face transformers": "hugging face",
  "retrieval-augmented generation": "rag",
  "retrieval augmented generation": "rag",
  "ml ops": "mlops",
  "amazon sagemaker": "sagemaker",
  "aws sagemaker": "sagemaker",
  "google vertex ai": "vertex ai",
  // DevOps
  "gitlab ci/cd": "gitlab ci",
  "gitlab-ci": "gitlab ci",
  argocd: "argo cd",
  "aws cloudformation": "cloudformation",
  "elastic kubernetes service": "eks",
  "amazon eks": "eks",
  "google kubernetes engine": "gke",
  "azure kubernetes service": "aks",
  // Security, QA, product, design
  "pen testing": "penetration testing",
  pentesting: "penetration testing",
  "identity and access management": "iam",
  "junit 5": "junit",
  "py.test": "pytest",
  prd: "prds",
  "product requirements documents": "prds",
  "product requirement documents": "prds",
  "adobe photoshop": "photoshop",
  "adobe illustrator": "illustrator",
  "ux research": "user research",
  "usability tests": "usability testing",
  "design system": "design systems",
  "wireframes": "wireframing",
  "prototypes": "prototyping",
};

export function normalizeSkill(skill: string): string {
  const s = skill
    .toLowerCase()
    .replace(/[“”"'`]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[.,;:]+$/, "");
  return SYNONYMS[s] ?? s;
}

/** Splits on commas that are not inside parentheses. */
function splitTopLevel(list: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of list) {
    if (ch === "(") depth++;
    if (ch === ")") depth = Math.max(0, depth - 1);
    if (ch === "," && depth === 0) {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out.map((s) => s.trim()).filter(Boolean);
}

/**
 * "AWS (Elastic Beanstalk, S3, RDS)" -> ["AWS", "AWS Elastic Beanstalk", "AWS S3", "AWS RDS"];
 * "C++ (used in CodeMirror multi-language support)" -> ["C++"] (a note, not a list).
 */
function expandItem(item: string): string[] {
  const m = item.match(/^(.*?)\s*\((.*)\)\s*$/);
  if (!m) return [item];
  const base = m[1].trim();
  const inner = splitTopLevel(m[2]);
  const isList = inner.length > 1 && inner.every((i) => i.split(" ").length <= 3);
  if (!isList) return [base];
  return [base, ...inner.map((i) => `${base} ${i}`), ...inner];
}

/**
 * Every skill listed in the master profile's skills section(s): lines shaped like
 * "- **Languages:** TypeScript, JavaScript" or "Frontend: React, Next.js" under a heading that
 * mentions "skill". Returns them in their original spelling, de-duplicated.
 */
export function parseSkillInventory(masterText: string): string[] {
  const lines = masterText.split(/\r?\n/);
  const items: string[] = [];
  let inSkills = false;
  for (const raw of lines) {
    const line = raw.trim();
    if (/^#{1,6}\s/.test(line)) {
      inSkills = /skill/i.test(line);
      continue;
    }
    if (!inSkills) continue;
    const m = line.replace(/\*\*/g, "").match(/^[-*•]?\s*([^:]{1,60}):\s*(.+)$/);
    if (!m) continue;
    for (const item of splitTopLevel(m[2])) items.push(...expandItem(item));
  }
  const seen = new Set<string>();
  return items.filter((i) => {
    const k = normalizeSkill(i);
    if (!k || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

import { mentionsTerm } from "./techTerms";

const SQL_DATABASES = ["postgresql", "mysql", "sqlite", "sql server", "t-sql", "oracle", "mariadb"];
const WAREHOUSES = ["snowflake", "bigquery", "redshift", "databricks"];

/**
 * A general skill counts as "have" when the inventory lists a specific one that implies it (keys
 * and values normalized). Only the inventory is checked, never free text, so this can't turn an
 * unrelated mention into a skill.
 */
export const IMPLIED_BY: Record<string, string[]> = {
  sql: [...SQL_DATABASES, ...WAREHOUSES],
  "relational databases": SQL_DATABASES,
  nosql: ["mongodb", "dynamodb", "cassandra", "redis", "firestore", "couchbase"],
  "data warehousing": WAREHOUSES,
  "data visualization": ["tableau", "power bi", "looker", "d3.js", "matplotlib"],
  "product analytics": ["amplitude", "mixpanel", "google analytics"],
  cloud: ["aws", "gcp", "azure"],
  aws: ["eks", "ec2", "lambda", "sagemaker", "cloudformation"],
  gcp: ["gke", "bigquery", "vertex ai"],
  azure: ["aks"],
  kubernetes: ["eks", "gke", "aks", "openshift"],
  containers: ["docker", "kubernetes", "podman"],
  "container orchestration": ["kubernetes", "eks", "gke", "aks"],
  "infrastructure as code": ["terraform", "cloudformation", "pulumi", "ansible"],
  "ci/cd": ["github actions", "jenkins", "gitlab ci", "circleci", "argo cd"],
  monitoring: ["prometheus", "grafana", "datadog", "splunk", "new relic"],
  observability: ["prometheus", "grafana", "datadog", "splunk", "new relic"],
  "unit testing": ["jest", "junit", "pytest", "testng", "vitest", "mocha"],
  testing: ["jest", "junit", "pytest", "testng", "vitest", "mocha", "cypress", "playwright", "selenium", "react testing library"],
  "test automation": ["selenium", "cypress", "playwright", "appium", "cucumber"],
  "machine learning": ["pytorch", "tensorflow", "scikit-learn", "xgboost", "jax"],
  "deep learning": ["pytorch", "tensorflow", "jax"],
  llms: ["openai api", "anthropic api", "claude api", "langchain", "hugging face"],
  "generative ai": ["openai api", "anthropic api", "claude api", "langchain", "llms"],
  orm: ["prisma", "hibernate", "jpa", "sqlalchemy", "sequelize", "typeorm", "entity framework", "django orm"],
  "version control": ["git"],
  prototyping: ["figma", "framer", "adobe xd"],
  "ui design": ["figma", "sketch", "adobe xd"],
};

/**
 * Whether an inventory item (normalized) is the specific skill `spec`: the same name, the name plus
 * a qualifier ("prisma orm" for "prisma", "aws eks" for "eks"), or one side of a slash pair
 * ("jpa/hibernate").
 */
function isSpecific(item: string, spec: string): boolean {
  const names = [item, ...item.split("/").map((p) => p.trim())];
  return names.some((n) => n === spec || n.startsWith(`${spec} `) || n.endsWith(` ${spec}`));
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Whole-word, case-insensitive "does this text mention this skill". Handles C++, Node.js, etc. */
function mentions(text: string, skill: string): boolean {
  if (!skill) return false;
  const re = new RegExp(`(^|[^a-z0-9+#])${escapeRe(skill)}($|[^a-z0-9+#])`, "i");
  return re.test(text);
}

/**
 * The parts of the master profile where a skill named in free text counts: Experience, Projects
 * and Skills sections. Leadership, education and the like describe her, not her skills ("Track &
 * Field" is not a skill). Text with no section headings at all (a resume's plain text, see
 * coverage.ts) is used whole.
 */
export function skillEvidenceText(masterText: string): string {
  const lines = masterText.split(/\r?\n/);
  if (!lines.some((l) => /^#{1,6}\s/.test(l.trim()))) return masterText;
  const keep: string[] = [];
  let counts = false;
  for (const raw of lines) {
    const line = raw.trim();
    if (/^#{1,6}\s/.test(line)) {
      counts = /experience|project|skill|work history|employment/i.test(line);
      continue;
    }
    if (counts) keep.push(raw);
  }
  return keep.join("\n");
}

const VENDOR_PREFIX = /^(?:amazon|aws|google cloud)\s+/i;

/**
 * Whether she has this skill: it's in the inventory (or a synonym of an inventory item), or the
 * master profile's Experience/Projects/Skills text mentions it as a whole word (e.g. a bullet
 * naming Docker). "Outer (Inner)" counts when either part does, and "Amazon S3" / "AWS S3" /
 * "Google Cloud Storage" are also tried without the vendor name.
 */
export function hasSkill(skill: string, inventory: string[], masterText: string): boolean {
  if (hasSkillAsWritten(skill, inventory, masterText)) return true;
  const paren = skill.trim().match(/^(.+?)\s*\((.+)\)$/);
  if (paren && (hasSkill(paren[1], inventory, masterText) || hasSkill(paren[2], inventory, masterText))) return true;
  const unprefixed = skill.trim().replace(VENDOR_PREFIX, "");
  return unprefixed !== skill.trim() && unprefixed.length > 0 && hasSkillAsWritten(unprefixed, inventory, masterText);
}

function hasSkillAsWritten(skill: string, inventory: string[], masterText: string): boolean {
  const n = normalizeSkill(skill);
  if (!n) return false;
  const inv = inventory.map(normalizeSkill);
  if (inv.includes(n)) return true;
  // "React Testing Library" vs inventory "React Testing Library"; "AWS S3" vs "S3".
  if (inv.some((i) => i.length > 2 && (mentions(n, i) || mentions(i, n)) && Math.min(i.length, n.length) / Math.max(i.length, n.length) > 0.5)) {
    return true;
  }
  if ((IMPLIED_BY[n] ?? []).some((spec) => inv.some((i) => isSpecific(i, spec)))) return true;
  const evidence = skillEvidenceText(masterText);
  // Free text: a short name (Go, R, C, Git) must match in its own capitalization, or ordinary
  // words ("go", "r&d") would count as the skill.
  if (skill.trim().length <= 4) {
    if (mentionsTerm(evidence, skill.trim())) return true;
    // A short alias of a longer name ("JS", "TS", "LLM", "k8s"): look for the name it stands for.
    return n !== skill.trim().toLowerCase() && mentions(evidence.toLowerCase(), n);
  }
  const lowerMaster = evidence.toLowerCase();
  if (mentions(lowerMaster, n)) return true;
  // Synonym spelled differently in the profile (JD "Postgres", profile "PostgreSQL").
  const reverse = Object.entries(SYNONYMS).filter(([, v]) => v === n).map(([k]) => k);
  return reverse.some((alt) => mentions(lowerMaster, alt));
}

export interface SkillMatch {
  have: string[];
  gap: string[];
}

export function matchSkills(jobSkills: string[], inventory: string[], masterText: string): SkillMatch {
  const have: string[] = [];
  const gap: string[] = [];
  const seen = new Set<string>();
  for (const s of jobSkills) {
    const key = normalizeSkill(s);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    (hasSkill(s, inventory, masterText) ? have : gap).push(s.trim());
  }
  return { have, gap };
}

/** Traits postings list under qualifications that aren't skills a resume can show or lack. */
const SOFT_SKILL = /\b(communication|attention to detail|detail[- ]oriented|team ?work|team player|collaborat\w*|attitude|upbeat|adaptab\w*|results[- ]oriented|self[- ]starter|motivated|passion\w*|curio\w*|work ethic|interpersonal|leadership skills|problem[- ]solving skills|fast[- ]paced|ownership|growth mindset)\b/i;

/** Words that make a phrase technical even when it contains a soft word ("inter-process communication"). */
const TECHNICAL_CONTEXT = /inter-?process|protocol|network|system|serial|socket|api|bus\b|data|machine|real-?time|async/i;

export function isSoftSkill(skill: string): boolean {
  return SOFT_SKILL.test(skill) && !TECHNICAL_CONTEXT.test(skill);
}

/** Drops soft skills from a match, so they don't move the skills percentage either way. */
export function dropSoftSkills(m: SkillMatch): SkillMatch {
  return { have: m.have.filter((s) => !isSoftSkill(s)), gap: m.gap.filter((s) => !isSoftSkill(s)) };
}

/**
 * Adds a skill she confirmed she has to the master profile's skills inventory, on an
 * "- **Additional:**" line (created if needed), so future tailoring can use it. Returns the text
 * unchanged if the inventory already lists it.
 */
export function appendSkillToMaster(master: string, skill: string): string {
  const name = skill.trim();
  if (!name || parseSkillInventory(master).some((s) => normalizeSkill(s) === normalizeSkill(name))) return master;
  const lines = master.split(/\r?\n/);
  const heading = lines.findIndex((l) => /^#{1,6}\s.*skill/i.test(l.trim()));
  if (heading < 0) return `${master.trimEnd()}\n\n### Skills inventory\n- **Additional:** ${name}\n`;
  let end = heading + 1;
  while (end < lines.length && !/^#{1,6}\s/.test(lines[end].trim())) end++;
  const extra = lines.slice(heading + 1, end).findIndex((l) => /^[-*•]?\s*\**additional:?\**:?/i.test(l.trim()));
  if (extra >= 0) {
    const i = heading + 1 + extra;
    lines[i] = `${lines[i].trimEnd()}, ${name}`;
  } else {
    let last = end - 1;
    while (last > heading && !lines[last].trim()) last--;
    lines.splice(last + 1, 0, `- **Additional:** ${name}`);
  }
  return lines.join("\n");
}

/**
 * Where she used a skill she confirmed ("I have this"), kept in her experience under this heading
 * as "- Kotlin: built an Android app in Mobile Development (class)". The heading avoids the word
 * "skill" on purpose, so these notes are never read as skills lines. A bullet may mention such a
 * skill only in the role or project its note names (validate.ts); with no note, Skills line only.
 */
export const USAGE_NOTES_HEADING = "Usage notes";

export interface UsageNote {
  skill: string;
  where: string;
}

export function parseUsageNotes(master: string): UsageNote[] {
  const out: UsageNote[] = [];
  let inside = false;
  for (const raw of master.split(/\r?\n/)) {
    const line = raw.trim();
    const h = line.match(/^#{1,6}\s+(.*)$/);
    if (h) {
      inside = h[1].trim().toLowerCase().startsWith(USAGE_NOTES_HEADING.toLowerCase());
      continue;
    }
    if (!inside) continue;
    const m = line.replace(/\*\*/g, "").match(/^[-*•]\s*([^:]{1,60}):\s*(.+)$/);
    if (m) out.push({ skill: m[1].trim(), where: m[2].trim() });
  }
  return out;
}

/** Adds (or replaces) the note for one skill under the Usage notes heading, creating it if needed. */
export function appendUsageNote(master: string, skill: string, where: string): string {
  const name = skill.trim();
  const text = where.replace(/\s+/g, " ").trim();
  if (!name || !text) return master;
  const line = `- ${name}: ${text}`;
  const lines = master.split(/\r?\n/);
  const heading = lines.findIndex((l) => new RegExp(`^#{1,6}\\s+${USAGE_NOTES_HEADING}`, "i").test(l.trim()));
  if (heading < 0) return `${master.trimEnd()}\n\n### ${USAGE_NOTES_HEADING}\n${line}\n`;
  let end = heading + 1;
  while (end < lines.length && !/^#{1,6}\s/.test(lines[end].trim())) end++;
  const existing = lines.slice(heading + 1, end).findIndex((l) => normalizeSkill(l.replace(/^[-*•]\s*/, "").split(":")[0] ?? "") === normalizeSkill(name));
  if (existing >= 0) lines[heading + 1 + existing] = line;
  else {
    let last = end - 1;
    while (last > heading && !lines[last].trim()) last--;
    lines.splice(last + 1, 0, line);
  }
  return lines.join("\n");
}
