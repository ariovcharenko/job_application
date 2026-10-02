import { altTitle, cleanTitle, parseMasterExperiences, type MasterEntry } from "../master/experiences";
import { hasSkill, normalizeSkill, parseSkillInventory, parseUsageNotes, type UsageNote } from "../master/skills";
import { mentionsTerm, TECH_TERMS } from "../master/techTerms";
import type { JobFocus } from "./focus";
import { polishResume } from "./polish";
import type { ResumeDoc } from "./schema";

// Code-side enforcement of the tailoring rules. The prompt asks the model to follow them; this
// checks the answer instead of trusting it. Mechanical rules (dashes, bold markers) are fixed
// silently. Two kinds of Flag:
//  - "block": a possible invention (a skill that appears nowhere in her experience, a number,
//    employer, title, date, degree or leadership role she doesn't have). Shown on the page struck
//    through and left OUT of the download unless she keeps it (decision #6).
//  - "note": true but worth a look (a technology from elsewhere in her experience used in a role
//    whose own text doesn't name it, or a "client"/"partner" claim that role doesn't make). Shown
//    highlighted and kept, unless she removes it. Real work is never silently dropped.

export type FlagKind = "skill" | "number" | "employer" | "education" | "leadership" | "claim";
export type FlagSeverity = "block" | "note";

export interface Flag {
  id: string;
  kind: FlagKind;
  severity: FlagSeverity;
  message: string;
  /** Where the flagged content is, so an unticked flag can be removed from the document. */
  target:
    | { section: "skills"; line: number; item: number }
    | { section: "experience"; entry: number; bullet?: number }
    | { section: "projects"; entry: number; bullet?: number }
    | { section: "education"; entry: number; bullet?: number }
    | { section: "leadership"; entry: number };
}

export interface ValidationResult {
  doc: ResumeDoc;
  flags: Flag[];
  /** Mechanical fixes applied without asking (e.g. "Replaced 3 dashes"). */
  fixes: string[];
}

/**
 * No "--", em dash or en dash. Spaced ones ("May 2026 – Aug 2026", "fast — and") become " - ";
 * unspaced ones between letters/digits ("end–to–end", "300–500") become a plain hyphen.
 */
export function fixDashes(text: string): { text: string; count: number } {
  let count = 0;
  const out = text
    .replace(/\s+(?:—|–|--+)\s+|\s+(?:—|–|--+)|(?:—|–|--+)\s+/g, () => {
      count++;
      return " - ";
    })
    .replace(/—|–|--+/g, () => {
      count++;
      return "-";
    });
  return { text: out, count };
}

/**
 * Drops ** markers if they don't pair up, so a stray one never shows as literal asterisks, and
 * removes empty bold spans ("****", "** **") while keeping their space. (It used to strip "** **"
 * wholesale, which also ate the space between two bold spans: "**Java 17** **Spring Boot**"
 * became "**Java 17Spring Boot**".)
 */
export function fixBoldMarkers(text: string): string {
  const parts = text.split("**");
  if (parts.length % 2 === 0) return text.replace(/\*\*/g, "");
  return parts.map((p, i) => (i % 2 === 1 ? (p.trim() ? `**${p}**` : p) : p)).join("");
}

export const plain = (text: string) => text.replace(/\*\*/g, "");

/** Every number in a string ("80+", "~35%", "p95", "250-450" -> "80","35","95","250","450"). */
export function numbersIn(text: string): string[] {
  return plain(text).match(/\d+(?:\.\d+)?/g) ?? [];
}

const normalizeLoose = (s: string) => s.toLowerCase().replace(/[^a-z0-9+#]+/g, " ").trim();

/** Whole-word "does `text` contain `phrase`", ignoring case and punctuation. */
const containsLoose = (text: string, phrase: string) => {
  const p = normalizeLoose(phrase);
  return p !== "" && ` ${normalizeLoose(text)} `.includes(` ${p} `);
};

const wordsOf = (s: string) => normalizeLoose(s).split(" ").filter(Boolean);

/** Every word of `phrase` appears somewhere in `text` (order and extra words don't matter). */
const allWordsIn = (phrase: string, text: string) => {
  const have = new Set(wordsOf(text));
  return wordsOf(phrase).every((w) => have.has(w));
};

function mapStrings(doc: ResumeDoc, fn: (s: string) => string): ResumeDoc {
  const entry = (e: ResumeDoc["experience"][number]) => ({
    title: fn(e.title),
    company: fn(e.company),
    location: fn(e.location),
    dates: fn(e.dates),
    bullets: e.bullets.map(fn),
  });
  return {
    education: doc.education.map((e) => ({
      school: fn(e.school),
      location: fn(e.location),
      degree: fn(e.degree),
      dates: fn(e.dates),
      bullets: e.bullets.map(fn),
    })),
    experience: doc.experience.map(entry),
    ...(doc.projects ? { projects: doc.projects.map(entry) } : {}),
    skills: doc.skills.map((l) => ({ category: fn(l.category), items: l.items.map(fn) })),
    leadership: doc.leadership.map((l) => ({ role: fn(l.role), dates: fn(l.dates) })),
    meta: doc.meta,
    ...(doc.layout ? { layout: doc.layout } : {}),
  };
}

/** "May 2026-Aug 2026" -> "May 2026 - Aug 2026". Only for date fields. */
const spaceDateDashes = (dates: string) => dates.replace(/\s*-\s*/g, " - ");

/**
 * Dates reduced to a comparable form: "September 2022 – June 2026" and "Sep 2022 - Jun 2026" both
 * become "aug 2023 - may 2027"; "Current" becomes "present". Anything else ("Summer 2026",
 * "05/2026", "2023 - 2027") stays as written, so it only matches the same text in the master.
 */
function normDates(s: string): string {
  return s
    .toLowerCase()
    .replace(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?/g, "$1")
    .replace(/\b(current|now|today)\b/g, "present")
    .replace(/[^a-z0-9-]+/g, " ")
    .replace(/\s*-\s*/g, " - ")
    .trim();
}

/** Whether these exact dates (as a whole range, not month by month) appear in `text`. */
function datesInText(dates: string, text: string): boolean {
  const d = normDates(dates);
  return d !== "" && ` ${normDates(text)} `.includes(` ${d} `);
}

/** The lines under every heading matching `heading` ("### Education"), or "" if there are none. */
function sectionText(master: string, heading: RegExp): string {
  const out: string[] = [];
  let inside = false;
  for (const raw of master.split(/\r?\n/)) {
    const h = raw.trim().match(/^#{1,6}\s+(.*)$/);
    if (h) {
      inside = heading.test(h[1]);
      continue;
    }
    if (inside) out.push(raw);
  }
  return out.join("\n");
}

/** The master entry an experience on the page claims to be: same company, then same title or dates. */
function findEntry(entries: MasterEntry[], e: ResumeDoc["experience"][number]): MasterEntry | undefined {
  const c = normalizeLoose(e.company);
  if (!c) return undefined;
  const same = entries.filter((m) => normalizeLoose(m.company) === c);
  const pool = same.length ? same : entries.filter((m) => containsLoose(m.company, e.company) || containsLoose(e.company, m.company));
  return pool.find((m) => titleMatches(e.title, m)) ?? pool.find((m) => normDates(m.dates) === normDates(e.dates)) ?? pool[0];
}

/**
 * The allowed title a page title stands for, or null. Accepts the main or alt title exactly, or a
 * combination of only those ("Main (Alt)", "Main / Alt", "Main, Alt"): then the first part wins.
 */
export function resolveTitle(title: string, m: MasterEntry): string | null {
  const allowed = [cleanTitle(m.title), altTitle(m.title)].filter(Boolean);
  const exact = allowed.find((x) => normalizeLoose(x) === normalizeLoose(cleanTitle(title)));
  if (exact) return exact;
  const parts = title
    .split(/\s*[()/,|]\s*|\s+-\s+/)
    .map((p) => p.replace(/^alt\.?\s*title:?\s*/i, "").trim())
    .filter(Boolean);
  if (parts.length < 2) return null;
  const matched = parts.map((p) => allowed.find((x) => normalizeLoose(x) === normalizeLoose(p)));
  return matched.every(Boolean) ? matched[0]! : null;
}

/** The page's title is the entry's main title or its "(alt. title: X)", with any such note ignored. */
function titleMatches(title: string, m: MasterEntry): boolean {
  const t = normalizeLoose(cleanTitle(title));
  if (!t) return true;
  return [cleanTitle(m.title), altTitle(m.title)].some((x) => x && normalizeLoose(x) === t);
}

/** Tool names with digits in them (S3, k6, p95, EC2): their digits aren't metrics. */
const ALNUM_TOKEN = /\b[A-Za-z]+\d+[A-Za-z0-9]*\b/g;

/** Numbers in a bullet that its own master entry (`block`) doesn't have. */
function unknownNumbers(bullet: string, block: string, master: string): string[] {
  const masterTokens = new Set((master.match(ALNUM_TOKEN) ?? []).map((t) => t.toLowerCase()));
  const text = plain(bullet).replace(ALNUM_TOKEN, (t) => (masterTokens.has(t.toLowerCase()) ? " " : t));
  const known = new Set(numbersIn(block));
  return [...new Set(numbersIn(text).filter((n) => !known.has(n)))];
}

const NUMBER_WORDS = /\b(two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|dozens?|hundreds|thousands|millions|doubled|tripled|halved)\b/gi;

/** Quantities written as words ("six teams", "doubled", "thousands of users") that `block` doesn't use. */
function unknownNumberWords(bullet: string, block: string): string[] {
  const words = [...new Set((plain(bullet).match(NUMBER_WORDS) ?? []).map((w) => w.toLowerCase()))];
  return words.filter((w) => !new RegExp(`\\b${w}\\b`, "i").test(block));
}

const TECH_KEYS = new Set(TECH_TERMS.map(normalizeSkill));

/**
 * A bold span that names a technology rather than an ordinary phrase: no digits (those are
 * metrics, checked as numbers), at most 5 words, and something tool-like about its spelling (a
 * capital letter or . + # /). "design system" and "end-to-end" don't qualify; "Kubernetes",
 * "CI/CD" and "Next.js" do. A lone past-tense verb the model bolded ("Owned", "Led") doesn't.
 */
const looksLikeTool = (span: string) =>
  !/\d/.test(span) &&
  !new RegExp(NUMBER_WORDS.source, "i").test(span) &&
  !/^[A-Z][a-z]*ed$/.test(span) &&
  span.split(/\s+/).length <= 5 &&
  /[A-Z.+#/]/.test(span);

/**
 * Claims about who the work was for or what kind of work it was. Easy to add in a rewrite and
 * not true unless the role's own text says so ("for client workflows", "external partners", "a UI
 * migration"). Each is a word stem; the role's text must use the same stem.
 */
const CLAIM_STEMS = ["client", "customer", "partner", "stakeholder", "enterprise", "vendor", "executive", "migrat"];

/** Claim words in a bullet that its own master entry (`block`) never uses. */
export function unknownClaims(bullet: string, block: string): string[] {
  const text = plain(bullet).toLowerCase();
  const source = block.toLowerCase();
  return CLAIM_STEMS.filter((stem) => new RegExp(`\\b${stem}`).test(text) && !new RegExp(`\\b${stem}`).test(source));
}

/**
 * Technologies a bullet mentions (its bold spans, plus known technology names written in their
 * usual capitalization), sorted by where her experience has them:
 *  - `missing`: nowhere in her experience (skills list, any role, any project, or a synonym). A
 *    possible invention: blocked until she keeps it.
 *  - `elsewhere`: in her experience, but not in this role's own text (or a usage note placing it
 *    there). True, so it stays; she gets a note to check it belongs in this role.
 */
export function classifyTools(bullet: string, block: string, inventory: string[], master: string): { missing: string[]; elsewhere: string[] } {
  const text = plain(bullet);
  const spans = [...bullet.matchAll(/\*\*(.+?)\*\*/g)].map((m) => m[1].trim()).filter(looksLikeTool);
  const terms = TECH_TERMS.filter(
    (t) => mentionsTerm(text, t, { exactCase: !t.includes(" ") }) && !spans.some((s) => mentionsTerm(s, t)),
  );
  const seen = new Set<string>();
  const missing: string[] = [];
  const elsewhere: string[] = [];
  for (const name of [...spans, ...terms]) {
    const key = normalizeSkill(name);
    if (seen.has(key)) continue;
    seen.add(key);
    // In this role: its own text names it, or a skill this role names implies it (synonyms too).
    const inRole =
      mentionsTerm(block, name) ||
      hasSkill(name, inventory.filter((i) => mentionsTerm(block, i)), block) ||
      (!TECH_KEYS.has(key) && containsLoose(block, name));
    if (inRole) continue;
    const anywhere = hasSkill(name, inventory, master) || (!TECH_KEYS.has(key) && containsLoose(master, name));
    (anywhere ? elsewhere : missing).push(name);
  }
  return { missing, elsewhere };
}

export interface ValidateOptions {
  /** The job's skills, so skills lines are ordered by what this job cares about most. */
  jobSkills?: string[];
  /** What the job is about (focus.ts): weights must-haves when ordering skills lines and their items. */
  focus?: JobFocus;
  /**
   * Add the job's skills she has (anywhere in her experience) that no skills line shows. Use right
   * after the model writes, not on her own edits, so a skill she removed by hand stays removed.
   */
  addJobSkills?: boolean;
}

const sameText = (a: string, b: string) => normalizeLoose(a) !== "" && normalizeLoose(a) === normalizeLoose(b);

/**
 * Her usage notes that belong to this role: a note tied to it exactly (same company, and same main
 * or alternate title when the note names one), or an older free-text note naming the company.
 */
export function notesForRole(notes: UsageNote[], company: string, title?: string): UsageNote[] {
  const core = company.split(/[,(]/)[0].trim();
  const titles = title ? [cleanTitle(title), altTitle(title)].filter(Boolean) : [];
  return notes.filter((n) => {
    if (n.role) {
      if (!sameText(n.role.company, company)) return false;
      return !n.role.title || titles.length === 0 || titles.some((t) => sameText(t, n.role!.title));
    }
    return core !== "" && containsLoose(n.where, core);
  });
}

export function validateResume(raw: ResumeDoc, masterProfile: string, opts: ValidateOptions = {}): ValidationResult {
  const fixes: string[] = [];
  let dashCount = 0;
  const doc = mapStrings(raw, (s) => {
    const d = fixDashes(s);
    dashCount += d.count;
    return fixBoldMarkers(d.text.replace(/\s+/g, " ").trim());
  });
  if (dashCount) fixes.push(`Replaced ${dashCount} dash${dashCount === 1 ? "" : "es"} with a hyphen.`);

  // Titles, skills and education are never bold; only bullets may carry ** markers.
  for (const e of doc.experience) Object.assign(e, { title: plain(e.title), company: plain(e.company) });
  for (const l of doc.skills) Object.assign(l, { category: plain(l.category), items: l.items.map(plain) });
  // Date ranges always read "Mon YYYY - Mon YYYY".
  for (const e of [...doc.experience, ...(doc.projects ?? []), ...doc.education, ...doc.leadership]) e.dates = spaceDateDashes(e.dates);
  // Mechanical polish by code: at most 4 bold spans per bullet, the usual casing of well-known
  // technologies, no skill listed twice (lib/resume/engine/polish.ts).
  const polished = polishResume(doc, {
    inventory: parseSkillInventory(masterProfile),
    master: masterProfile,
    jobSkills: opts.jobSkills,
    focus: opts.focus,
    addJobSkills: opts.addJobSkills,
  });
  Object.assign(doc, polished.doc);
  fixes.push(...polished.notes);

  const flags: Flag[] = [];
  const master = masterProfile;
  const masterLoose = normalizeLoose(master);
  const inventory = parseSkillInventory(master);
  const entries = parseMasterExperiences(master);
  // Her notes on where she used a skill she confirmed count as part of the role or project they name.
  const notes = parseUsageNotes(master);
  const withNotes = (block: string, company: string, title?: string) => {
    const extra = notesForRole(notes, company, title).map((n) => `${n.skill}: ${n.where}`);
    return extra.length ? `${block}\n${extra.join("\n")}` : block;
  };

  doc.skills.forEach((line, li) =>
    line.items.forEach((item, ii) => {
      // A skill counts as hers if it's anywhere in her experience: her skills list (including the
      // ones she confirmed), a role or project's text, or a synonym of one. Only a skill that
      // appears nowhere is blocked.
      if (!hasSkill(item, inventory, master)) {
        flags.push({
          id: `skill-${li}-${ii}`,
          kind: "skill",
          severity: "block",
          message: `"${item}" isn't in your experience.`,
          target: { section: "skills", line: li, item: ii },
        });
      }
    }),
  );

  /** Tool and number flags for one bullet, checked against its own entry's master text. */
  const checkBullet = (b: string, block: string, where: string, idPrefix: string, target: Flag["target"]) => {
    const tools = classifyTools(b, block, inventory, master);
    tools.missing.forEach((tool, k) =>
      flags.push({
        id: `${idPrefix}tool-${k}`,
        kind: "skill",
        severity: "block",
        message: `"${tool}" isn't in your experience (${where}: "${plain(b)}")`,
        target,
      }),
    );
    if (tools.elsewhere.length) {
      const names = tools.elsewhere.map((t) => `"${t}"`).join(", ");
      flags.push({
        id: `${idPrefix}elsewhere`,
        kind: "skill",
        severity: "note",
        message: `${names} ${tools.elsewhere.length === 1 ? "is" : "are"} in your experience, but not in ${where === "education" ? "your education" : "this role"} (${where}). Keep it only if you used ${tools.elsewhere.length === 1 ? "it" : "them"} here.`,
        target,
      });
    }
    const claims = unknownClaims(b, block);
    if (claims.length) {
      flags.push({
        id: `${idPrefix}claim`,
        kind: "claim",
        severity: "note",
        message: `Says "${claims.join('", "')}", which ${where === "education" ? "your education" : "this role"} in your experience doesn't: "${plain(b)}"`,
        target,
      });
    }
    const unknown = [...unknownNumbers(b, block, master), ...unknownNumberWords(b, block)];
    if (unknown.length) {
      flags.push({
        id: `${idPrefix}num`,
        kind: "number",
        severity: "block",
        message: `Uses ${unknown.join(", ")}, which isn't in ${where === "education" ? "your education" : "this role"} in your experience: "${plain(b)}"`,
        target,
      });
    }
  };

  // Something her experience lists under Projects goes in Projects, even if the model put it under
  // Experience.
  if (entries.length) {
    const isProject = (e: ResumeDoc["experience"][number]) => /project/i.test(findEntry(entries, e)?.section ?? "");
    const moved = doc.experience.filter(isProject);
    if (moved.length) {
      doc.experience = doc.experience.filter((e) => !isProject(e));
      doc.projects = [...(doc.projects ?? []), ...moved];
      fixes.push(`Moved ${moved.map((e) => e.company).join(", ")} to Projects, where your experience lists it.`);
    }
  }

  let headersCorrected = 0;
  doc.experience.forEach((e, ei) => {
    const entry = entries.length ? findEntry(entries, e) : undefined;
    let problems: string[];
    if (entry) {
      // Header facts are fixed by her rules, so code writes them from the matched role instead of
      // dropping the whole role over a wording difference: dates and location exactly as in her
      // experience, and a title made only of her main/alt titles ("Main (Alt)", "Main / Alt") becomes
      // the one the model led with. A title that isn't hers is still flagged below.
      const resolved = resolveTitle(e.title, entry);
      const before = `${e.title}|${e.dates}|${e.location}`;
      if (resolved) e.title = resolved;
      if (entry.dates) e.dates = spaceDateDashes(entry.dates);
      if (entry.location) e.location = entry.location;
      if (`${e.title}|${e.dates}|${e.location}` !== before) headersCorrected++;
      problems = [
        !titleMatches(e.title, entry) && `title "${e.title}"`,
        e.dates && normDates(e.dates) !== normDates(entry.dates) && `dates "${e.dates}"`,
        e.location && normalizeLoose(e.location) !== normalizeLoose(entry.location) && `location "${e.location}"`,
      ].filter((x): x is string => Boolean(x));
      if (problems.length) {
        flags.push({
          id: `exp-${ei}`,
          kind: "employer",
          severity: "block",
          message: `${problems.join(", ")} doesn't match your ${entry.company} role in your experience (${entry.title} | ${entry.location ? `${entry.location} | ` : ""}${entry.dates}).`,
          target: { section: "experience", entry: ei },
        });
      }
    } else {
      // No such company among her roles (or a master profile without role headings): check each
      // field against the whole profile.
      const companyOk = masterLoose.includes(normalizeLoose(e.company));
      const titleCore = normalizeLoose(cleanTitle(e.title));
      const titleOk = titleCore === "" || masterLoose.includes(titleCore);
      const datesOk = !e.dates || datesInText(e.dates, master);
      problems = [!companyOk && `company "${e.company}"`, !titleOk && `title "${e.title}"`, !datesOk && `dates "${e.dates}"`].filter(
        (x): x is string => Boolean(x),
      );
      if (problems.length) {
        flags.push({ id: `exp-${ei}`, kind: "employer", severity: "block", message: `${problems.join(", ")} not found in your experience.`, target: { section: "experience", entry: ei } });
      }
    }
    const block = withNotes(entry?.block ?? master, entry?.company ?? e.company, entry?.title ?? e.title);
    e.bullets.forEach((b, bi) => checkBullet(b, block, `${e.company}, bullet ${bi + 1}`, `exp-${ei}-${bi}-`, { section: "experience", entry: ei, bullet: bi }));
  });

  // Projects: same checks as roles, against the master's project entries.
  (doc.projects ?? []).forEach((e, pi) => {
    const entry = entries.length ? findEntry(entries, e) : undefined;
    if (entry) {
      const before = `${e.title}|${e.dates}|${e.location}`;
      const resolved = resolveTitle(e.title, entry);
      if (resolved) e.title = resolved;
      if (entry.dates) e.dates = spaceDateDashes(entry.dates);
      e.location = entry.location;
      if (`${e.title}|${e.dates}|${e.location}` !== before) headersCorrected++;
      if (!titleMatches(e.title, entry)) {
        flags.push({ id: `proj-${pi}`, kind: "employer", severity: "block", message: `title "${e.title}" doesn't match your ${entry.company} project in your experience.`, target: { section: "projects", entry: pi } });
      }
    } else {
      flags.push({ id: `proj-${pi}`, kind: "employer", severity: "block", message: `project "${e.company}" not found in your experience.`, target: { section: "projects", entry: pi } });
    }
    const block = withNotes(entry?.block ?? "", entry?.company ?? e.company, entry?.title ?? e.title);
    e.bullets.forEach((b, bi) => checkBullet(b, block, `${e.company}, bullet ${bi + 1}`, `proj-${pi}-${bi}-`, { section: "projects", entry: pi, bullet: bi }));
  });

  const eduText = sectionText(master, /education/i) || master;
  // Education: a coursework line only if her experience lists coursework (checked like any bullet
  // below), and when her experience gives a major GPA, never any other GPA.
  const majorGpa = /major\s+gpa/i.test(eduText);
  const listsCoursework = /coursework/i.test(eduText);
  let eduDropped = 0;
  for (const e of doc.education) {
    const keep = e.bullets.filter(
      (b) => !(!listsCoursework && /^\s*(relevant\s+)?coursework\b/i.test(plain(b))) && !(majorGpa && /\bgpa\b/i.test(b) && !/major\s+gpa/i.test(b)),
    );
    eduDropped += e.bullets.length - keep.length;
    e.bullets = keep;
  }
  if (eduDropped) fixes.push(`Left off ${eduDropped} Education line${eduDropped === 1 ? "" : "s"} your experience doesn't have (coursework or a GPA other than your major GPA).`);
  if (headersCorrected) fixes.push(`Used your exact title, dates and location for ${headersCorrected} role${headersCorrected === 1 ? "" : "s"}.`);

  doc.education.forEach((e, ei) => {
    const problems = [
      !masterLoose.includes(normalizeLoose(e.school)) && `school "${e.school}"`,
      !allWordsIn(e.degree, eduText) && `degree "${e.degree}"`,
      e.location && !containsLoose(eduText, e.location) && `location "${e.location}"`,
      e.dates && !datesInText(e.dates, eduText) && `dates "${e.dates}"`,
    ].filter((x): x is string => Boolean(x));
    if (problems.length) {
      flags.push({
        id: `edu-${ei}`,
        kind: "education",
        severity: "block",
        message: `${problems.join(", ")} doesn't match your experience's education.`,
        target: { section: "education", entry: ei },
      });
    }
    e.bullets.forEach((b, bi) => checkBullet(b, eduText, "education", `edu-${ei}-${bi}-`, { section: "education", entry: ei, bullet: bi }));
  });

  // Leadership: each role must be one line of the master's leadership section (all of its words),
  // with the same dates on that line or the one after it.
  const leadLines = sectionText(master, /leadership|involvement|activit|extracurricular|volunteer/i)
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  doc.leadership.forEach((l, li) => {
    const lines = leadLines.map((line, i) => ({ line, withNext: `${line}\n${leadLines[i + 1] ?? ""}` })).filter((x) => allWordsIn(l.role, x.line));
    const roleOk = wordsOf(l.role).length === 0 || lines.length > 0;
    const datesOk = !l.dates || lines.some((x) => datesInText(l.dates, x.withNext));
    if (!roleOk || !datesOk) {
      flags.push({
        id: `lead-${li}`,
        kind: "leadership",
        severity: "block",
        message: roleOk
          ? `"${l.role}": dates "${l.dates}" don't match your experience's leadership section.`
          : `"${l.role}" isn't in your experience's leadership section.`,
        target: { section: "leadership", entry: li },
      });
    }
  });

  // An "(alt. title: X)" note is for choosing a title, never for the page.
  for (const e of [...doc.experience, ...(doc.projects ?? [])]) e.title = cleanTitle(e.title);

  return { doc, flags, fixes };
}

/**
 * The document as downloaded: every blocking flag she hasn't kept is removed. Notes never remove
 * anything (she removes a noted line herself if she wants). Pure; the original is untouched.
 */
export function applyApprovals(doc: ResumeDoc, flags: Flag[], approved: Set<string>): ResumeDoc {
  const drop = flags.filter((f) => f.severity !== "note" && !approved.has(f.id));
  const dropped = (pred: (f: Flag) => boolean) => drop.some(pred);
  const bulletOf = (f: Flag) => ("bullet" in f.target ? f.target.bullet : undefined);
  return {
    ...doc,
    education: doc.education
      .map((e, ei) => ({
        ...e,
        bullets: e.bullets.filter((_, bi) => !dropped((f) => f.target.section === "education" && f.target.entry === ei && bulletOf(f) === bi)),
      }))
      .filter((_, ei) => !dropped((f) => f.target.section === "education" && f.target.entry === ei && bulletOf(f) === undefined)),
    experience: doc.experience
      .map((e, ei) => ({
        ...e,
        bullets: e.bullets.filter((_, bi) => !dropped((f) => f.target.section === "experience" && f.target.entry === ei && bulletOf(f) === bi)),
      }))
      .filter((_, ei) => !dropped((f) => f.target.section === "experience" && f.target.entry === ei && bulletOf(f) === undefined)),
    ...(doc.projects
      ? {
          projects: doc.projects
            .map((e, pi) => ({
              ...e,
              bullets: e.bullets.filter((_, bi) => !dropped((f) => f.target.section === "projects" && f.target.entry === pi && bulletOf(f) === bi)),
            }))
            .filter((_, pi) => !dropped((f) => f.target.section === "projects" && f.target.entry === pi && bulletOf(f) === undefined)),
        }
      : {}),
    skills: doc.skills
      .map((l, li) => ({
        ...l,
        items: l.items.filter((_, ii) => !dropped((f) => f.target.section === "skills" && f.target.line === li && f.target.item === ii)),
      }))
      .filter((l) => l.items.length > 0),
    leadership: doc.leadership.filter((_, li) => !dropped((f) => f.target.section === "leadership" && f.target.entry === li)),
  };
}

/** Plain text of the whole resume, for keyword coverage. */
export function resumeText(doc: ResumeDoc): string {
  return [
    ...doc.education.flatMap((e) => [e.school, e.degree, ...e.bullets]),
    ...doc.experience.flatMap((e) => [e.title, e.company, ...e.bullets]),
    ...(doc.projects ?? []).flatMap((e) => [e.title, e.company, ...e.bullets]),
    ...doc.skills.map((l) => `${l.category}: ${l.items.join(", ")}`),
    ...doc.leadership.map((l) => l.role),
  ]
    .map(plain)
    .join("\n");
}


/**
 * Flag messages used to say "master profile"; saved ticks are matched by message, so old ticks are
 * read through this to keep matching after the wording changed to "your experience".
 */
export function normalizeFlagMessage(message: string): string {
  return message.replace(/your master profile's/g, "your experience's").replace(/(in )?your master profile/g, (_m, pre) => `${pre ?? ""}your experience`);
}
