import type { Target } from "../engine/edit";
import type { ResumeDoc } from "../engine/schema";
import { isSoftSkill, normalizeSkill } from "../master/skills";
import { mentionsTerm, TECH_TERM_FAMILIES, TECH_TERMS } from "../master/techTerms";
import {
  BUZZWORDS,
  FIRST_PERSON,
  IRREGULAR_PAST,
  NEUTRAL_ING,
  OFFICE_FILLER,
  SOFT_OPENERS,
  STOPWORDS,
  WEAK_OPENERS,
} from "./lexicon";
import { segments, wrapBullet } from "./measure";
import type { LintContext, QualityIssue, QualityRule, Severity } from "./types";

export type { LintContext, QualityIssue, QualityRule, Severity } from "./types";

// A deterministic resume quality linter: no AI call, no browser. It reads a tailored ResumeDoc
// the way a senior tech recruiter skims one and reports what makes it weaker or reads as
// AI-written. It does NOT re-check facts against the master profile (validate.ts owns that) and it
// never changes the document: every issue carries a fixHint the app can send to the model as a
// revision comment (see summary.ts issuesToComments).
//
// False-positive policy: a strong, specific bullet should produce no "fix" issue. Anything that is
// a judgment call (thin bullet, missing number, widow line, soft verb, keyword coverage) is only
// "consider". Rules that look at the whole page (repetition, templated "-ing" endings) only fire
// past a count, never on a single occurrence.

/** Every threshold in one place, so tuning is a one-line change. */
export const THRESHOLDS = {
  /** More estimated lines than this (at 9 pt TNR in the 7.5in bullet column) is too long. */
  maxLines: 2,
  /** Hard character cap, in case the width estimate is generous. ~2 full lines. */
  maxChars: 260,
  /** Experience bullets shorter than this read as thin. Half a line. */
  minChars: 60,
  /** A wrapped bullet whose last line has this many words or fewer is a "widow". */
  widowMaxWords: 3,
  /** Her bolding rule: 2 to 4 bold spans per bullet. */
  maxBoldSpans: 4,
  /** A bold span longer than this is a bolded phrase, not a technology or metric. */
  maxBoldWords: 4,
  /** Her rule: no opening verb more than twice on the page. */
  maxVerbUses: 2,
  /** The same technology bolded in more bullets than this dilutes the emphasis. */
  maxTechBoldBullets: 3,
  /** Content-word Jaccard overlap between two bullets: "fix" at or above, "consider" at or above. */
  duplicateFix: 0.7,
  duplicateConsider: 0.5,
  /** Bullets with fewer content words than this are never compared (short ones overlap by chance). */
  duplicateMinTokens: 5,
  /** Word n-gram length for repeated phrases. */
  phraseGram: 4,
  /** ", improving X" endings: flagged from the Nth such bullet, if they're at least this share. */
  trailingIngMin: 4,
  trailingIngShare: 0.4,
  /** "cross-functional" in more bullets than this. */
  maxCrossFunctional: 1,
  /** Her rule: 5 to 7 skills lines. */
  skillsLinesMin: 5,
  skillsLinesMax: 7,
  /** Her recruiter-review bar: at least this share of the job's have-skills on the page. */
  keywordCoverage: 0.7,
  /** The job's top N required skills should appear in the top third. */
  topRequired: 3,
  /** The first role's first N bullets count as the "top third". */
  topBullets: 3,
};

interface Bullet {
  section: "experience" | "education";
  entry: number;
  bullet: number;
  /** As written, with ** markers. */
  raw: string;
  /** Plain text. */
  text: string;
  /** The entry's dates end in Present/Current, so present tense is allowed. */
  current: boolean;
}

const plain = (s: string) => s.replace(/\*\*/g, "");
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const isCurrent = (dates: string) => /\b(present|current|now|today)\s*$/i.test(dates.trim());

function collectBullets(doc: ResumeDoc): Bullet[] {
  const out: Bullet[] = [];
  doc.experience.forEach((e, entry) =>
    e.bullets.forEach((raw, bullet) =>
      out.push({ section: "experience", entry, bullet, raw, text: plain(raw).trim(), current: isCurrent(e.dates) }),
    ),
  );
  doc.education.forEach((e, entry) =>
    e.bullets.forEach((raw, bullet) =>
      out.push({ section: "education", entry, bullet, raw, text: plain(raw).trim(), current: isCurrent(e.dates) }),
    ),
  );
  return out;
}

const targetOf = (b: Bullet): Target => ({ section: b.section, entry: b.entry, bullet: b.bullet });

function where(doc: ResumeDoc, b: Bullet): string {
  const name = b.section === "experience" ? doc.experience[b.entry]?.company || doc.experience[b.entry]?.title : doc.education[b.entry]?.school;
  return `${name || b.section}, bullet ${b.bullet + 1}`;
}

/** Past tense: "-ed", a known irregular, or a hyphenated verb whose last part is ("Co-led", "Re-architected"). */
export function isPastTense(word: string): boolean {
  const w = word.toLowerCase();
  if (IRREGULAR_PAST.has(w)) return true;
  if (/^[a-z]{2,}ed$/.test(w)) return true;
  const parts = w.split("-");
  return parts.length > 1 && isPastTense(parts[parts.length - 1]);
}

const firstWord = (text: string) => (text.match(/^[A-Za-z][A-Za-z'-]*/)?.[0] ?? text.split(/\s+/)[0] ?? "").replace(/-$/, "");

/** Lowercase content words for overlap checks: punctuation stripped, stopwords dropped. */
function contentTokens(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9+#.%\s-]/g, " ")
    .split(/\s+/)
    .map((t) => t.replace(/^[.-]+|[.-]+$/g, ""))
    .filter((t) => t.length > 1 && !STOPWORDS.has(t));
}

function jaccard(a: string[], b: string[]): number {
  const A = new Set(a);
  const B = new Set(b);
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  return inter / (A.size + B.size - inter || 1);
}

/** Whether a skill shows on the text, by its own spelling or its normalized one ("Postgres" -> PostgreSQL). */
function skillIn(text: string, items: Set<string>, skill: string): boolean {
  const s = skill.trim();
  if (!s) return true;
  const n = normalizeSkill(s);
  if (items.has(n)) return true;
  if (mentionsTerm(text, s)) return true;
  // The normalized form is lowercase, so only try it where mentionsTerm matches case-insensitively.
  return n.length > 4 && mentionsTerm(text, n);
}

export function lintResume(doc: ResumeDoc, ctx: LintContext = {}): QualityIssue[] {
  const issues: QualityIssue[] = [];
  const ids = new Set<string>();
  const T = THRESHOLDS;

  const add = (rule: QualityRule, severity: Severity, key: string, fields: Omit<QualityIssue, "id" | "rule" | "severity">) => {
    const loc = fields.target
      ? `${fields.target.section}.${fields.target.entry}${fields.target.bullet !== undefined ? `.${fields.target.bullet}` : ""}`
      : "page";
    let id = `${rule}:${loc}:${key}`;
    for (let n = 2; ids.has(id); n++) id = `${rule}:${loc}:${key}#${n}`;
    ids.add(id);
    issues.push({ id, rule, severity, ...fields });
  };

  const bullets = collectBullets(doc);
  const expBullets = bullets.filter((b) => b.section === "experience");
  const techWords = new Set<string>([
    ...TECH_TERMS.flatMap((t) => t.toLowerCase().split(/\s+/)),
    ...doc.skills.flatMap((l) => l.items.flatMap((i) => i.toLowerCase().split(/\s+/))),
  ]);

  // ---------- Per-bullet rules ----------
  const verbUses = new Map<string, Bullet[]>();
  const trailingIng: { b: Bullet; ing: string }[] = [];
  const crossFunctional: Bullet[] = [];

  for (const b of bullets) {
    const target = targetOf(b);
    const isExp = b.section === "experience";
    const opener = firstWord(b.text);
    const openerLower = opener.toLowerCase();

    // Buzzwords and filler.
    for (const bw of BUZZWORDS) {
      const m = b.text.match(bw.pattern);
      if (!m || (bw.unless && bw.unless.test(b.text))) continue;
      // The opening-verb rule already covers a weak opener like "Helped".
      if (isExp && m.index === 0 && (WEAK_OPENERS.has(openerLower) || SOFT_OPENERS.has(openerLower))) continue;
      const word = m[0].replace(/^[,\s]+/, "").trim();
      add("buzzword", bw.severity, bw.key, {
        target,
        quote: word,
        message:
          bw.severity === "fix"
            ? `"${word}" reads as filler or AI-written.`
            : `"${word}" is often vague on a resume.`,
        fixHint: `Replace "${word}" with ${bw.instead}.`,
      });
    }

    // First person.
    const fp = b.text.match(FIRST_PERSON);
    if (fp) {
      const word = fp[0].replace(/^[^A-Za-z]+/, "");
      add("first-person", "fix", word.toLowerCase(), {
        target,
        quote: word,
        message: `Uses first person ("${word}"). Resume bullets leave out I, my, we and our.`,
        fixHint: `Rewrite without "${word}": start with the action verb and leave out first-person words.`,
      });
    }

    if (/\bcross[- ]functional\b/i.test(b.text)) crossFunctional.push(b);

    const ing = b.text.match(/,\s+(?:and\s+|while\s+|thereby\s+)?([a-z]+ing)\b/);
    if (ing && !NEUTRAL_ING.has(ing[1])) trailingIng.push({ b, ing: ing[1] });

    // Opening verb (experience bullets only: education bullets are often "Relevant coursework: ...").
    if (isExp && opener) {
      if (WEAK_OPENERS.has(openerLower)) {
        add("verb-weak", "fix", openerLower, {
          target,
          quote: opener,
          message: `Opens with "${opener}", which undersells what you did.`,
          fixHint: `Start with a strong action verb for the part you did yourself (Built, Wrote, Led, Designed), not "${opener}".`,
        });
      } else if (SOFT_OPENERS.has(openerLower)) {
        add("verb-soft", "consider", openerLower, {
          target,
          quote: opener,
          message: `"${opener}" is a soft opener; a more specific verb is stronger.`,
          fixHint: `If accurate, start with a more specific verb than "${opener}" (Built, Implemented, Designed).`,
        });
      } else if (!b.current && !isPastTense(opener)) {
        add("verb-tense", "fix", openerLower, {
          target,
          quote: opener,
          message: `Starts with "${opener}", not a past-tense action verb.`,
          fixHint: `Start this bullet with a past-tense action verb (Built, Shipped, Designed, Implemented) instead of "${opener}".`,
        });
      }
      if (/^[a-z-]+$/.test(openerLower)) {
        const list = verbUses.get(openerLower) ?? [];
        list.push(b);
        verbUses.set(openerLower, list);
      }
    }

    // Length and wrapping.
    const wrap = wrapBullet(b.raw);
    const lines = wrap.lines.length;
    let thin = false;
    if (lines > T.maxLines || b.text.length > T.maxChars) {
      add("too-long", "fix", "length", {
        target,
        message: `Runs to about ${Math.max(lines, 3)} lines (${b.text.length} characters). Bullets should be 1 to 2 lines.`,
        fixHint: "Shorten this bullet to at most 2 lines (about 250 characters): cut filler words, keep the technologies and numbers.",
      });
    } else if (isExp && lines === 2 && wrap.lines[1].length <= T.widowMaxWords) {
      const tail = wrap.lines[1].join(" ").replace(/\*\*/g, "");
      add("widow", "consider", "widow", {
        target,
        quote: tail,
        message: `The second line holds only "${tail}", so a whole line is spent on ${wrap.lines[1].length === 1 ? "one word" : "a few words"}.`,
        fixHint: "Tighten this bullet by a few words so it fits on one line, or add a concrete detail from your experience so the second line is used.",
      });
    }
    if (isExp && b.text.length < T.minChars) {
      thin = true;
      add("too-thin", "consider", "length", {
        target,
        message: `Short (${b.text.length} characters); it may undersell the work.`,
        fixHint: "Add the technology used or the result (with its number, if your experience notes have one). Don't invent details.",
      });
    }

    // Bold.
    const bold = segments(b.raw).filter((s) => s.bold).map((s) => s.text.trim()).filter(Boolean);
    const hasNumber = /\d/.test(b.text);
    const hasTech = bold.length > 0 || TECH_TERMS.some((t) => mentionsTerm(b.text, t));
    if (isExp && !thin && !hasNumber && !hasTech) {
      add("no-substance", "consider", "substance", {
        target,
        message: "No technology and no number: this bullet says what, but not with what or how much.",
        fixHint: "Name the technology used or add the result with its number, if your experience notes have one. Don't invent details.",
      });
    }
    if (bold.length > T.maxBoldSpans) {
      add("bold-too-many", "fix", "count", {
        target,
        message: `${bold.length} bold spans; more than ${T.maxBoldSpans} and nothing stands out.`,
        fixHint: `Keep bold on at most ${T.maxBoldSpans} spans in this bullet (the technologies and numbers that matter most for this job) and unbold the rest.`,
      });
    }
    bold.forEach((span, i) => {
      const words = span.split(/\s+/);
      if (words.length > T.maxBoldWords) {
        add("bold-phrase", "fix", `span${i}`, {
          target,
          quote: span,
          message: `"${span}" is a bolded phrase. Bold only technologies and numbers.`,
          fixHint: `Unbold "${span}" and bold only the technology or number inside it, if any.`,
        });
      } else if (
        (i === 0 && b.raw.trimStart().startsWith("**") && !/\d/.test(span) && !TECH_TERMS.some((t) => mentionsTerm(span, t))) ||
        (words.length === 1 && isPastTense(span) && !techWords.has(span.toLowerCase()))
      ) {
        add("bold-verb", "fix", `span${i}`, {
          target,
          quote: span,
          message: `"${span}" is bold but isn't a technology or number.`,
          fixHint: `Unbold "${span}"; bold only technologies and numbers.`,
        });
      }
    });
  }

  // Bold outside bullets (validate.ts strips these, but the linter can also run on raw output).
  const noBold = (text: string, target: Target, what: string) => {
    if (text.includes("**"))
      add("bold-outside-bullets", "fix", what, {
        target,
        quote: plain(text),
        message: `The ${what} has bold markers; bold belongs only inside bullets.`,
        fixHint: `Remove the ** bold markers from the ${what} "${plain(text)}".`,
      });
  };
  doc.experience.forEach((e, entry) => {
    noBold(e.title, { section: "experience", entry }, "title");
    noBold(e.company, { section: "experience", entry }, "company");
  });
  doc.education.forEach((e, entry) => {
    noBold(e.school, { section: "education", entry }, "school");
    noBold(e.degree, { section: "education", entry }, "degree");
  });
  doc.skills.forEach((l, entry) => {
    noBold(l.category, { section: "skills", entry }, "skills category");
    l.items.forEach((it, i) => noBold(it, { section: "skills", entry }, `skill ${i + 1}`));
  });
  doc.leadership.forEach((l, entry) => noBold(l.role, { section: "leadership", entry }, "leadership entry"));

  // ---------- Page-level repetition ----------
  for (const [verb, list] of verbUses) {
    if (list.length <= T.maxVerbUses) continue;
    const word = cap(verb);
    list.slice(T.maxVerbUses).forEach((b) =>
      add("verb-repeat", "fix", verb, {
        target: targetOf(b),
        quote: firstWord(b.text),
        message: `"${word}" opens ${list.length} bullets; use each opening verb at most ${T.maxVerbUses} times.`,
        fixHint: `Start this bullet with a different, accurate verb than "${word}" (for example Implemented, Developed, Created, Delivered), keeping the meaning.`,
      }),
    );
  }

  crossFunctional.slice(T.maxCrossFunctional).forEach((b) =>
    add("cross-functional-overuse", "consider", "cross-functional", {
      target: targetOf(b),
      quote: "cross-functional",
      message: `"cross-functional" appears in ${crossFunctional.length} bullets.`,
      fixHint: 'Replace "cross-functional" here with who you actually worked with (designers, clinic staff, the data team).',
    }),
  );

  const allCount = bullets.length;
  if (trailingIng.length >= T.trailingIngMin && trailingIng.length / Math.max(1, allCount) >= T.trailingIngShare) {
    trailingIng.slice(T.trailingIngMin - 1).forEach(({ b, ing }) =>
      add("trailing-ing-overuse", "consider", ing, {
        target: targetOf(b),
        quote: `, ${ing}`,
        message: `${trailingIng.length} of ${allCount} bullets end with a ", ...ing" result clause, a pattern that reads as templated.`,
        fixHint: `Rephrase this bullet so the result isn't a trailing ", ${ing} ..." clause (for example "cut X by Y" as its own clause, or lead with the result).`,
      }),
    );
  }

  // Same technology bolded too often.
  const boldTech = new Map<string, { label: string; bullets: Set<number> }>();
  expBullets.forEach((b, i) => {
    for (const s of segments(b.raw)) {
      const span = s.text.trim();
      if (!s.bold || !span || /\d/.test(span)) continue;
      const key = normalizeSkill(span);
      const cur = boldTech.get(key) ?? { label: span, bullets: new Set<number>() };
      cur.bullets.add(i);
      boldTech.set(key, cur);
    }
  });
  for (const [key, { label, bullets: set }] of boldTech) {
    if (set.size <= T.maxTechBoldBullets) continue;
    add("tech-repeat", "consider", key, {
      quote: label,
      message: `"${label}" is bold in ${set.size} bullets; repeating it dilutes the emphasis.`,
      fixHint: `Keep "${label}" bold in at most ${T.maxTechBoldBullets} bullets (the strongest ones) and unbold it elsewhere.`,
    });
  }

  // Near-duplicate bullets and repeated phrases.
  const tokens = expBullets.map((b) => contentTokens(b.text));
  const pairFlagged = new Set<string>();
  for (let j = 1; j < expBullets.length; j++) {
    for (let i = 0; i < j; i++) {
      if (tokens[i].length < T.duplicateMinTokens || tokens[j].length < T.duplicateMinTokens) continue;
      const sim = jaccard(tokens[i], tokens[j]);
      if (sim < T.duplicateConsider) continue;
      const severity: Severity = sim >= T.duplicateFix ? "fix" : "consider";
      pairFlagged.add(`${i}:${j}`);
      add("near-duplicate", severity, `with-${i}`, {
        target: targetOf(expBullets[j]),
        message: `Says much the same as ${where(doc, expBullets[i])}.`,
        fixHint: `This bullet repeats ${where(doc, expBullets[i])}; replace it with a different accomplishment from this role, or cut it.`,
      });
      break;
    }
  }
  const N = T.phraseGram;
  const firstSeen = new Map<string, number>();
  const phraseFlagged = new Set<number>();
  expBullets.forEach((b, j) => {
    const words = b.text.toLowerCase().replace(/[^a-z0-9+#.\s-]/g, " ").split(/\s+/).map((w) => w.replace(/^[.-]+|[.-]+$/g, "")).filter(Boolean);
    for (let k = 0; k + N <= words.length; k++) {
      const gram = words.slice(k, k + N);
      if (gram.some((w) => /\d/.test(w))) continue;
      const content = gram.filter((w) => !STOPWORDS.has(w));
      if (content.length < 2 || content.every((w) => techWords.has(w))) continue;
      const key = gram.join(" ");
      const i = firstSeen.get(key);
      if (i === undefined) {
        firstSeen.set(key, j);
        continue;
      }
      if (i === j || phraseFlagged.has(j) || pairFlagged.has(`${i}:${j}`)) continue;
      phraseFlagged.add(j);
      add("phrase-repeat", "consider", `with-${i}`, {
        target: targetOf(b),
        quote: key,
        message: `Repeats the phrase "${key}" from ${where(doc, expBullets[i])}.`,
        fixHint: `Reword "${key}" here so it doesn't repeat ${where(doc, expBullets[i])}.`,
      });
    }
  });

  // Mixed trailing periods.
  const withPeriod = bullets.filter((b) => /\.$/.test(b.text));
  if (withPeriod.length > 0 && withPeriod.length < bullets.length) {
    add("trailing-period", "consider", "periods", {
      message: `${withPeriod.length} of ${bullets.length} bullets end with a period and the rest don't.`,
      fixHint: "End every bullet the same way: no trailing periods.",
    });
  }

  // ---------- Per-role ----------
  doc.experience.forEach((e, entry) => {
    if (e.bullets.length === 0 || e.bullets.some((raw) => /\d/.test(plain(raw)))) return;
    add("role-unquantified", "consider", "numbers", {
      target: { section: "experience", entry },
      message: `No bullet in the ${e.company || e.title} role has a number.`,
      fixHint: `If your experience notes have a number for the ${e.company || e.title} role (users, %, time saved, features shipped), add it to its strongest bullet. Don't invent one.`,
    });
  });

  // ---------- Skills section ----------
  const lines = doc.skills.length;
  if (lines < T.skillsLinesMin || lines > T.skillsLinesMax) {
    add("skills-line-count", "consider", "count", {
      target: lines ? { section: "skills", entry: 0 } : undefined,
      message:
        lines === 0
          ? "There's no technical skills section."
          : `The skills section has ${lines} line${lines === 1 ? "" : "s"}; ${T.skillsLinesMin} to ${T.skillsLinesMax} is typical for a one-page tech resume.`,
      fixHint:
        lines > T.skillsLinesMax
          ? `Merge or drop skills lines so there are at most ${T.skillsLinesMax}, keeping the job's skills first.`
          : `If your skills inventory supports it, split the skills into ${T.skillsLinesMin} to ${T.skillsLinesMax} clearer lines (for example Languages, Frontend, Backend, Databases, Cloud, Testing).`,
    });
  }
  const seen = new Map<string, number>();
  const languages = new Set(TECH_TERM_FAMILIES.languages.map((l) => l.toLowerCase()));
  const techPage = doc.skills.some((l) => l.items.some((i) => languages.has(normalizeSkill(i))));
  doc.skills.forEach((l, entry) =>
    l.items.forEach((raw) => {
      const item = plain(raw).trim();
      const n = normalizeSkill(item);
      const target: Target = { section: "skills", entry };
      if (seen.has(n)) {
        add("skills-duplicate", "fix", n, {
          target,
          quote: item,
          message: `"${item}" is listed twice in the skills section.`,
          fixHint: `Remove the repeated "${item}" from the ${l.category} skills line.`,
        });
      } else seen.set(n, entry);
      if (isSoftSkill(item)) {
        add("skills-soft", "fix", n, {
          target,
          quote: item,
          message: `"${item}" is a soft skill; the technical skills section is for tools and technologies.`,
          fixHint: `Remove "${item}" from the skills section.`,
        });
      } else if (techPage && OFFICE_FILLER.test(item)) {
        add("skills-filler", "consider", n, {
          target,
          quote: item,
          message: `"${item}" is assumed for a tech role and takes space from stronger skills.`,
          fixHint: `Remove "${item}" from the skills section unless the job asks for it.`,
        });
      }
    }),
  );

  // ---------- Keyword coverage (only with job context) ----------
  const skillItems = new Set(doc.skills.flatMap((l) => l.items.map((i) => normalizeSkill(plain(i)))));
  const pageText = [...bullets.map((b) => b.text), ...doc.skills.map((l) => `${l.category}: ${l.items.map(plain).join(", ")}`)].join("\n");
  const uniq = (list: string[]) => {
    const out = new Map<string, string>();
    for (const s of list) if (s.trim() && !isSoftSkill(s) && !out.has(normalizeSkill(s))) out.set(normalizeSkill(s), s.trim());
    return [...out.values()];
  };
  if (ctx.jobSkills?.length) {
    const have = uniq(ctx.jobSkills);
    const missing = have.filter((s) => !skillIn(pageText, skillItems, s));
    if (have.length && missing.length) {
      const covered = have.length - missing.length;
      const pct = Math.round((covered / have.length) * 100);
      const below = covered / have.length < T.keywordCoverage;
      add("keywords-missing", "consider", "coverage", {
        message: `${covered} of ${have.length} job skills you have are on the page (${pct}%)${below ? `, under the ${Math.round(T.keywordCoverage * 100)}% aim` : ""}. Missing: ${missing.join(", ")}.`,
        fixHint: `Work ${missing.join(", ")} into a bullet or the skills section, using the job's spelling, only where your experience supports it.`,
      });
    }
  }
  if (ctx.requiredSkills?.length) {
    const top = uniq(ctx.requiredSkills).slice(0, T.topRequired);
    const first = doc.experience[0];
    const topText = [
      ...doc.education.flatMap((e) => e.bullets.map(plain)),
      ...(first ? first.bullets.slice(0, T.topBullets).map(plain) : []),
      doc.skills[0] ? `${doc.skills[0].category}: ${doc.skills[0].items.map(plain).join(", ")}` : "",
    ].join("\n");
    const topItems = new Set((doc.skills[0]?.items ?? []).map((i) => normalizeSkill(plain(i))));
    // Only skills that are on the page somewhere: a real gap belongs to validate/meta, not here.
    const buried = top.filter((s) => skillIn(pageText, skillItems, s) && !skillIn(topText, topItems, s));
    if (buried.length) {
      add("keywords-not-top", "consider", "top", {
        message: `The job's top required skill${buried.length > 1 ? "s" : ""} ${buried.join(", ")} ${buried.length > 1 ? "are" : "is"} on the page but not in the top third, where a recruiter looks first.`,
        fixHint: `Surface ${buried.join(", ")} in the first role's first bullets or the first skills line, where it is true to your experience.`,
      });
    }
  }

  // "fix" first, otherwise page order.
  return issues.map((x, i) => ({ x, i })).sort((a, b) => (a.x.severity === b.x.severity ? a.i - b.i : a.x.severity === "fix" ? -1 : 1)).map(({ x }) => x);
}
