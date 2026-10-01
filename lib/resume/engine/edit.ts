import type { ResumeDoc } from "./schema";

// Edits she makes by hand on the visible resume, applied by code with no AI call: remove a bullet,
// an entry or a skills line, and add a skill she confirmed. Pure functions over ResumeDoc.

export type Section = "education" | "experience" | "projects" | "skills" | "leadership";

/** A spot on the page, read from the preview's data attributes (see html.ts). */
export interface Target {
  section: Section;
  entry: number;
  /** A bullet inside an education or experience entry. Absent = the whole entry (or skills line). */
  bullet?: number;
}

const plain = (s: string) => s.replace(/\*\*/g, "");

/** "Brightloop, bullet 2", "the Taskwise role", "the Languages skills line", for comments and buttons. */
export function describeTarget(doc: ResumeDoc, t: Target): string {
  if (t.section === "experience") {
    const e = doc.experience[t.entry];
    if (!e) return "this part";
    return t.bullet === undefined ? `the ${e.company} role` : `${e.company}, bullet ${t.bullet + 1}`;
  }
  if (t.section === "projects") {
    const e = doc.projects?.[t.entry];
    if (!e) return "this part";
    return t.bullet === undefined ? `the ${e.company} project` : `${e.company}, bullet ${t.bullet + 1}`;
  }
  if (t.section === "education") {
    const e = doc.education[t.entry];
    if (!e) return "this part";
    return t.bullet === undefined ? `the ${e.school} entry` : `${e.school}, bullet ${t.bullet + 1}`;
  }
  if (t.section === "skills") return doc.skills[t.entry] ? `the ${doc.skills[t.entry].category} skills line` : "this skills line";
  return doc.leadership[t.entry] ? `"${plain(doc.leadership[t.entry].role)}"` : "this entry";
}

/** The document without that bullet, entry, skills line or leadership item. */
export function removeTarget(doc: ResumeDoc, t: Target): ResumeDoc {
  const drop = <T,>(list: T[], i: number) => list.filter((_, j) => j !== i);
  if (t.section === "skills") return { ...doc, skills: drop(doc.skills, t.entry) };
  if (t.section === "leadership") return { ...doc, leadership: drop(doc.leadership, t.entry) };
  const key = t.section;
  const entries = (key === "projects" ? (doc.projects ?? []) : doc[key]) as ResumeDoc["experience"] | ResumeDoc["education"];
  if (t.bullet === undefined) return { ...doc, [key]: drop(entries as never[], t.entry) };
  return {
    ...doc,
    [key]: entries.map((e, i) => (i === t.entry ? { ...e, bullets: drop(e.bullets, t.bullet!) } : e)),
  };
}

/** Which skills line a skill belongs on, by what the line is called. */
const GROUPS: { line: RegExp; skill: RegExp }[] = [
  { line: /language/i, skill: /^(python|java|javascript|typescript|go|golang|rust|swift|objective-c|kotlin|c|c\+\+|c#|ruby|php|scala|r|sql|bash|dart)$/i },
  { line: /front/i, skill: /react|next|vue|angular|svelte|html|css|tailwind|redux|swiftui|uikit|flutter|react native/i },
  { line: /back|api/i, skill: /node|express|django|flask|fastapi|spring|rails|\.net|graphql|rest|grpc|microservice/i },
  { line: /data|database/i, skill: /sql|postgres|mysql|mongo|redis|dynamo|cassandra|elastic|snowflake|bigquery|kafka|spark|airflow|dbt|pandas|numpy|database/i },
  { line: /cloud|devops|infra/i, skill: /aws|gcp|azure|docker|kubernetes|terraform|linux|ci\/cd|github actions|jenkins|cloud/i },
  { line: /test/i, skill: /jest|cypress|playwright|selenium|test/i },
  { line: /\bai\b|ml|machine|tool/i, skill: /llm|pytorch|tensorflow|scikit|machine learning|deep learning|nlp|openai|ai\b|git|figma/i },
];

/** Adds a skill to the best-fitting skills line (or an "Additional" line), unless it's already there. */
export function addSkill(doc: ResumeDoc, skill: string): ResumeDoc {
  const name = skill.trim();
  if (!name) return doc;
  if (doc.skills.some((l) => l.items.some((i) => i.toLowerCase() === name.toLowerCase()))) return doc;
  const groupOf = (s: string) => GROUPS.find((g) => g.skill.test(s));
  const group = groupOf(name);
  // The model renames categories to mirror the job ("Platforms"), so first look for the line that
  // already holds skills of the same kind, then fall back to what the line is called.
  let index = group ? doc.skills.findIndex((l) => l.items.some((i) => groupOf(i) === group)) : -1;
  if (index < 0 && group) index = doc.skills.findIndex((l) => group.line.test(l.category));
  if (index < 0) index = doc.skills.findIndex((l) => /additional|other/i.test(l.category));
  if (index < 0) return { ...doc, skills: [...doc.skills, { category: "Additional", items: [name] }] };
  return { ...doc, skills: doc.skills.map((l, i) => (i === index ? { ...l, items: [...l.items, name] } : l)) };
}

/**
 * The spot a selection in the preview falls in, read from the data attributes html.ts writes.
 * Takes the element the selection starts in; browser-only, but no DOM types are needed beyond
 * `closest` and `getAttribute`.
 */
export function targetFromElement(el: { closest(sel: string): { getAttribute(name: string): string | null } | null } | null): Target | null {
  if (!el) return null;
  const holder = el.closest("[data-sec]");
  if (!holder) return null;
  const section = holder.getAttribute("data-sec") as Section | null;
  const entry = Number(holder.getAttribute("data-e"));
  if (!section || Number.isNaN(entry)) return null;
  const li = el.closest("[data-b]");
  const bullet = li ? Number(li.getAttribute("data-b")) : undefined;
  return { section, entry, ...(bullet !== undefined && !Number.isNaN(bullet) ? { bullet } : {}) };
}
