import { z } from "zod";
import { AIError, type AIProvider, type JsonSchema } from "../../ai/provider";
import type { SkillReadiness } from "../coverage";
import { cleanTitle, parseMasterExperiences, type MasterEntry } from "../master/experiences";
import { hasSkill, normalizeSkill, parseSkillInventory } from "../master/skills";
import { describeTarget, type Section, type Target } from "./edit";
import { keywordComments } from "./pipeline";
import { masterEntryFor } from "./places";
import { buildSystemPrompt } from "./prompt";
import type { ResumeComment } from "./revise";
import type { ResumeDoc } from "./schema";
import { classifyTools, fixDashes, numbersIn, unknownClaims } from "./validate";

// "Recruiter review": the model reads the current tailored page as this company's recruiter and
// says what to change for the page to read like the ideal candidate's. The model only WRITES the
// advice. Code decides what each item may do (lib/resume/engine/review.ts planReviewItems):
//  - a change that only uses facts already in her experience becomes a targeted revision comment
//    (the same revise.ts call and validate.ts checks as every other update);
//  - anything that would need a fact her experience doesn't have (a skill, a tool, a number, a
//    claim about who the work was for) becomes a QUESTION to her, never a change. A skill she then
//    says she has goes through the "I have this" path (saved to her experience, decision #6).
// Even when a change slips through, the revision's answer is checked by validateResume, which
// leaves out anything not in her experience until she ticks it. The review never bypasses that.
// The readiness numbers shown next to the review are counted by code (coverage.ts skillReadiness),
// never by the model (decision #7).

export const REVIEW_KINDS = ["missing_skill", "skill_unproven", "keyword", "weak_bullet", "metric", "emphasis", "irrelevant", "alignment"] as const;
export type ReviewKind = (typeof REVIEW_KINDS)[number];
export const REVIEW_PRIORITIES = ["high", "medium", "low"] as const;
export type ReviewPriority = (typeof REVIEW_PRIORITIES)[number];
const SECTIONS = ["experience", "projects", "skills", "education", "leadership", "whole"] as const;

/** "medium": one careful read of a page; "high" would mean minutes of waiting for advice. */
export const REVIEW_EFFORT = "medium" as const;
/** Room for thinking at medium plus up to 10 short items. Under the SDK's non-streaming cap. */
export const REVIEW_MAX_TOKENS = 12000;
/** At most this many model items are shown (most important first). */
export const MAX_REVIEW_ITEMS = 10;
const JD_CHAR_LIMIT = 20000;

/** One item as the model returns it. */
const RawItemSchema = z.object({
  kind: z.string(),
  priority: z.string(),
  title: z.string(),
  why: z.string(),
  change: z.string(),
  section: z.string(),
  entry: z.number(),
  bullet: z.number(),
  skill: z.string(),
  needsFact: z.boolean(),
  question: z.string(),
});
export type RawReviewItem = z.infer<typeof RawItemSchema>;

const RawReviewSchema = z.object({ summary: z.string(), items: z.array(z.unknown()) });

const str = { type: "string" } as const;

export const REVIEW_JSON_SCHEMA: JsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["summary", "items"],
  properties: {
    summary: { ...str, description: "One or two sentences: how this page reads to you as this company's recruiter, plainly." },
    items: {
      type: "array",
      description: `At most ${MAX_REVIEW_ITEMS} changes, most important first.`,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["kind", "priority", "title", "why", "change", "section", "entry", "bullet", "skill", "needsFact", "question"],
        properties: {
          kind: { type: "string", enum: [...REVIEW_KINDS] },
          priority: { type: "string", enum: [...REVIEW_PRIORITIES] },
          title: { ...str, description: "What to fix, in at most 10 words, e.g. \"Show Kafka in the Brightloop bullets\"." },
          why: { ...str, description: "One sentence: why this matters to this employer for this job." },
          change: {
            ...str,
            description:
              "The specific change to make to the page, as an instruction to a resume writer, using only facts in the MASTER PROFILE. Empty when it needs a fact the profile doesn't have.",
          },
          section: { type: "string", enum: [...SECTIONS] },
          entry: { type: "integer", description: "Index of the entry (or skills line) in that section of the CURRENT PAGE, or -1 for the whole section or page." },
          bullet: { type: "integer", description: "Index of the bullet in that entry, or -1 for the whole entry." },
          skill: { ...str, description: "The one job skill this item is about, in the job's spelling, or empty." },
          needsFact: { type: "boolean", description: "True when the change needs a skill, tool, number, employer, scope or result the MASTER PROFILE doesn't state." },
          question: { ...str, description: "When needsFact is true: the question to ask the candidate, e.g. \"Have you used Kubernetes? If yes, where?\". Otherwise empty." },
        },
      },
    },
  },
};

/** One review item after code checked it. */
export interface ReviewFinding {
  id: string;
  kind: ReviewKind;
  priority: ReviewPriority;
  title: string;
  why: string;
  change: string;
  /** On the page the review was given (the visible, fitted page), when the item is about one spot. */
  target?: Target;
  skill?: string;
  needsFact: boolean;
  question: string;
}

export interface RecruiterReview {
  summary: string;
  findings: ReviewFinding[];
}

const clean = (s: string) => fixDashes(s.replace(/\s+/g, " ").trim()).text;

/** A target the page really has, or undefined (whole page / section). */
export function toTarget(doc: ResumeDoc, section: string, entry: number, bullet: number): Target | undefined {
  if (!(SECTIONS as readonly string[]).includes(section) || section === "whole") return undefined;
  const s = section as Section;
  if (!Number.isInteger(entry) || entry < 0) return undefined;
  const list = (
    s === "experience" ? doc.experience : s === "projects" ? (doc.projects ?? []) : s === "education" ? doc.education : s === "skills" ? doc.skills : doc.leadership
  ) as { bullets?: string[] }[];
  const e = list[entry];
  if (!e) return undefined;
  if (!Number.isInteger(bullet) || bullet < 0 || !e.bullets || !e.bullets[bullet]) return { section: s, entry };
  return { section: s, entry, bullet };
}

/**
 * The model's answer, checked: a broken item is dropped (not the whole review), text is trimmed and
 * dash-free, targets point at spots that exist on the page, duplicates and empty items go, and at
 * most MAX_REVIEW_ITEMS remain, high priority first. A missing or malformed answer throws
 * AIError("invalid_output"), shown like any other failed call.
 */
export function parseReview(raw: unknown, doc: ResumeDoc): RecruiterReview {
  const top = RawReviewSchema.safeParse(raw);
  if (!top.success) throw new AIError("invalid_output", "The review came back in an unexpected shape. Try again.");
  const findings: ReviewFinding[] = [];
  const seen = new Set<string>();
  top.data.items.forEach((item, i) => {
    const r = RawItemSchema.safeParse(item);
    if (!r.success) return;
    const it = r.data;
    const kind = (REVIEW_KINDS as readonly string[]).includes(it.kind) ? (it.kind as ReviewKind) : null;
    if (!kind) return;
    const priority = (REVIEW_PRIORITIES as readonly string[]).includes(it.priority) ? (it.priority as ReviewPriority) : "medium";
    const title = clean(it.title);
    const change = clean(it.change);
    const question = clean(it.question);
    if (!title || (!change && !question)) return;
    const key = `${kind}:${normalizeSkill(it.skill) || title.toLowerCase()}`;
    if (seen.has(key)) return;
    seen.add(key);
    const target = toTarget(doc, it.section, it.entry, it.bullet);
    const skill = clean(it.skill);
    findings.push({
      id: `review:${i}:${kind}`,
      kind,
      priority,
      title,
      why: clean(it.why),
      change,
      ...(target ? { target } : {}),
      ...(skill ? { skill } : {}),
      needsFact: it.needsFact || (!change && !!question),
      question,
    });
  });
  const rank = (p: ReviewPriority) => REVIEW_PRIORITIES.indexOf(p);
  return {
    summary: clean(top.data.summary),
    findings: findings.sort((a, b) => rank(a.priority) - rank(b.priority)).slice(0, MAX_REVIEW_ITEMS),
  };
}

/** The page with each spot labeled, so the model can name exact targets. */
function pageForReview(doc: ResumeDoc): string {
  const lines: string[] = [];
  doc.education.forEach((e, i) => {
    lines.push(`education[${i}] ${e.degree}, ${e.school} (${e.dates})`);
    e.bullets.forEach((b, j) => lines.push(`  education[${i}].bullet[${j}] ${b}`));
  });
  (["experience", "projects"] as const).forEach((section) =>
    (doc[section] ?? []).forEach((e, i) => {
      lines.push(`${section}[${i}] ${e.title} | ${e.company} | ${e.location} | ${e.dates}`);
      e.bullets.forEach((b, j) => lines.push(`  ${section}[${i}].bullet[${j}] ${b}`));
    }),
  );
  doc.skills.forEach((s, i) => lines.push(`skills[${i}] ${s.category}: ${s.items.join(", ")}`));
  doc.leadership.forEach((l, i) => lines.push(`leadership[${i}] ${l.role} (${l.dates})`));
  return lines.join("\n");
}

export interface ReviewInput {
  company: string;
  role: string;
  jdText: string;
  /** The page as she sees it (the fitted page), so targets match the preview. */
  doc: ResumeDoc;
  /** Code's count of the job's key skills on the page, so the model doesn't re-count them. */
  readiness: SkillReadiness;
}

export function buildReviewPrompt(input: ReviewInput): string {
  const r = input.readiness;
  const notShown = r.skills.filter((s) => !r.shown.includes(s));
  const unproven = r.shown.filter((s) => !r.proven.includes(s));
  const lacking = r.skills.filter((s) => !r.inProfile.includes(s));
  const list = (xs: string[]) => (xs.length ? xs.join(", ") : "none");
  return `TASK: RECRUITER REVIEW. Do not write a resume this time.

You are the recruiter and hiring manager at ${input.company || "this company"} hiring for "${input.role || "this role"}". Read the CURRENT PAGE below the way you would in a real screen, against the JOB DESCRIPTION, and tell the candidate exactly what to change so this page reads like the ideal candidate for this job.

Job description:
"""
${input.jdText.trim().slice(0, JD_CHAR_LIMIT)}
"""

CURRENT PAGE (each line starts with its spot, e.g. experience[1].bullet[0]; bold spans are marked with **):
${pageForReview(input.doc)}

Counted by the app (trust these, don't recount):
- The job's key skills: ${list(r.skills)}
- Not on the page: ${list(notShown)}
- On the page only in Skills, not named in any bullet: ${list(unproven)}
- Not in the MASTER PROFILE at all: ${list(lacking)}

Look for, in order of what costs this candidate the interview:
1. Key skills missing from the page, or listed in Skills but never shown in a bullet where the MASTER PROFILE shows they were used.
2. The job's exact words and phrases (ATS and recruiter keywords) the candidate truly matches but the page words differently.
3. Weak or vague bullets: no clear action, no technology, no result, filler.
4. Missing numbers where the MASTER PROFILE has one for that role.
5. Wrong emphasis or order: the job's most important work buried, less relevant content taking space.
6. Content that doesn't help for this job and could give its space to something that does.
7. Title and focus alignment with the role (only using titles the MASTER PROFILE gives, including alternate titles).

Rules:
- Truth first. Every "change" may only use facts in the MASTER PROFILE (skills, tools, numbers, employers, titles, dates, scope, results). Never suggest inflating scope or seniority.
- If the best fix needs something the MASTER PROFILE doesn't state (a skill or tool it doesn't list, a number it doesn't give, who the work was for), set needsFact to true, leave "change" empty and write "question": a short, direct question to the candidate, e.g. "Have you used Kubernetes? If yes, where?" or "Do you know how many users the Taskwise app reached?".
- Point at the exact spot (section, entry, bullet) on the CURRENT PAGE when the item is about one spot; use section "whole" and -1 otherwise. Don't refer to spots by number inside "change"; the spot fields carry that.
- One item per problem, the most important first, at most ${MAX_REVIEW_ITEMS}. Skip anything that is already strong. If the page is already strong for this job, return few items.
- No em dashes, en dashes or double dashes. Plain, specific words.`;
}

/**
 * One call to the smart model (same cached system prompt as tailoring, so her experience is reused
 * from the cache). Takes any AIProvider, so routing it to another provider is a change at the call
 * site (getProvider) only.
 */
export async function reviewResume(provider: AIProvider, masterProfile: string, input: ReviewInput, onProgress?: (chars: number) => void, signal?: AbortSignal): Promise<RecruiterReview> {
  return provider.completeJson<RecruiterReview>({
    tier: "smart",
    effort: REVIEW_EFFORT,
    maxTokens: REVIEW_MAX_TOKENS,
    system: buildSystemPrompt(masterProfile),
    cacheSystem: true,
    prompt: buildReviewPrompt(input),
    schema: REVIEW_JSON_SCHEMA,
    parse: (raw) => parseReview(raw, input.doc),
    onProgress,
    signal,
  });
}

// ---------------------------------------------------------------------------------------------
// What each item may do, decided by code.

export type ReviewAction =
  /** Queue a targeted revision (one "Apply" call sends every queued one). Only facts she has. */
  | { type: "revise"; comment: ResumeComment }
  /** A job skill her experience has but the page doesn't show: add it (free), optionally to a role. */
  | { type: "add_skill"; skill: string }
  /** A skill her experience doesn't show: "Have you used X? If yes, where?" via "I have this". */
  | { type: "ask_skill"; skill: string; question: string }
  /**
   * A key skill she has, shown only in Skills, that no role on the page shows using: "Where did you
   * use X?" She picks the role (saved as a usage note, decision #6), then the update names it there.
   */
  | { type: "place_skill"; skill: string; question: string }
  /** Needs a fact (a number, a scope) only she can give: her typed answer becomes the comment. */
  | { type: "ask_fact"; question: string; target?: Target; change: string };

export interface ReviewItem {
  id: string;
  kind: ReviewKind;
  priority: ReviewPriority;
  title: string;
  why: string;
  /** What will be changed (empty for questions). */
  detail: string;
  /** Where on the page, in words ("Brightloop, bullet 2"), when it is about one spot. */
  where?: string;
  /** Spot on the page the review was given (visible page coordinates). */
  target?: Target;
  /** The job skill the item is about (normalized), when there is one: one row per skill. */
  skill?: string;
  /** The spot's text when the item was made (a bullet, a skills line, an entry's company), to find it again. */
  quote?: string;
  /** True when found by code, free, available before any review call. */
  fromCode: boolean;
  action: ReviewAction;
}

export interface PlanContext {
  /** The page the review saw (visible page). */
  doc: ResumeDoc;
  master: string;
  /** The job's key skills, most important first (required ones first). */
  keySkills: string[];
  /** Every job skill, for code items beyond the key ones. */
  jobSkills: string[];
  /** Whether a skill is one of the job's required ones (for priority). */
  isRequired: (skill: string) => boolean;
}

/**
 * Facts in a piece of model-written advice that her experience doesn't have: technologies it names
 * that her experience never mentions, numbers it never gives, and claims about who the work was for.
 * Any hit turns the item into a question. Pure, tested.
 */
export function unverifiedFacts(text: string, master: string): string[] {
  if (!text.trim()) return [];
  const inventory = parseSkillInventory(master);
  const tools = classifyTools(text, master, inventory, master).missing;
  const known = new Set(numbersIn(master));
  const numbers = numbersIn(text).filter((n) => !known.has(n));
  const claims = unknownClaims(text, master);
  return [...tools, ...numbers, ...claims];
}

const SKILL_KINDS: ReviewKind[] = ["missing_skill", "skill_unproven", "keyword"];

const revisionNote = (change: string) =>
  `${change} Use only facts in the MASTER PROFILE; if this can't be done truthfully, leave it unchanged and say why. Change nothing else and keep the page the same length.`;

/** The first role or project in her experience that shows `skill` in its own lines and isn't on the page. */
export function entryShowingOffPage(doc: ResumeDoc, master: string, skill: string): MasterEntry | undefined {
  const onPage = [...doc.experience, ...(doc.projects ?? [])].map((e) => e.company);
  const entries = parseMasterExperiences(master);
  return entries.find((m) => !onPage.some((c) => masterEntryFor([m], c)) && hasSkill(skill, [], m.block.split("\n").slice(1).join("\n")));
}

/** The free, code-found items: the job's skills the page doesn't show, or shows only in Skills. */
export function codeReviewItems(ctx: PlanContext): ReviewItem[] {
  const inventory = parseSkillInventory(ctx.master);
  const pageText = pageTextOf(ctx.doc);
  const bullets = bulletTextOf(ctx.doc);
  const items: ReviewItem[] = [];
  const seen = new Set<string>();
  const ordered = [...ctx.keySkills, ...ctx.jobSkills];
  for (const skill of ordered) {
    const key = normalizeSkill(skill);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const priority: ReviewPriority = ctx.isRequired(skill) ? "high" : "medium";
    const have = hasSkill(skill, inventory, ctx.master);
    if (!have) {
      const question = `Have you used ${skill}? If yes, where?`;
      items.push({ id: `code:ask:${key}`, kind: "missing_skill", priority, title: `The job asks for ${skill}`, why: ctx.isRequired(skill) ? "It's a required skill, and Your experience doesn't show it yet." : "The job mentions it, and Your experience doesn't show it yet.", detail: "", fromCode: true, action: { type: "ask_skill", skill, question } });
      continue;
    }
    if (!hasSkill(skill, [], pageText)) {
      items.push({ id: `code:add:${key}`, kind: "missing_skill", priority, title: `Add ${skill} to the page`, why: "It's in Your experience, and recruiters and ATS filters look for it by name.", detail: `Adds ${skill} to Skills, and to a role if you pick one.`, fromCode: true, action: { type: "add_skill", skill } });
      continue;
    }
    if (ctx.keySkills.includes(skill) && !hasSkill(skill, [], bullets)) {
      const [comment] = keywordComments(ctx.doc, ctx.master, [skill]);
      const offPage = !comment ? entryShowingOffPage(ctx.doc, ctx.master, skill) : undefined;
      if (offPage) {
        // Her experience shows it in a role or project that isn't on this page: bring that one in
        // (true and specific) instead of asking where she used it among roles that didn't.
        const project = /project/i.test(offPage.section);
        const label = `${cleanTitle(offPage.title)} | ${offPage.company} | ${offPage.dates}`;
        items.push({
          id: `code:bring:${key}`,
          kind: "skill_unproven",
          priority,
          title: `Show ${skill}: add ${offPage.company}`,
          why: `Your experience shows ${skill} in ${offPage.company}, which isn't on this page.`,
          detail: `Adds ${offPage.company} to ${project ? "Projects" : "Experience"} with the bullets that show ${skill}, and trims the least relevant bullets to stay on one page.`,
          fromCode: true,
          action: {
            type: "revise",
            comment: {
              id: `code:bring:${key}`,
              quote: "",
              note: `Add my "${label}" entry from the MASTER PROFILE to the page under ${project ? "Projects" : "Experience"}, with 2 bullets taken from its own lines that show where ${skill} was used. To keep the page one page, drop the least relevant bullets elsewhere (never below 2 per role). Change nothing else.`,
            },
          },
        });
      } else if (!comment) {
        // No role on the page shows it in her experience, so a bullet naming it would be invented.
        items.push({ id: `code:place:${key}`, kind: "skill_unproven", priority, title: `Show ${skill} in a bullet`, why: "Listed only in Skills, and no role on the page shows where you used it.", detail: "", fromCode: true, action: { type: "place_skill", skill, question: `Where did you use ${skill}?` } });
      } else {
        items.push({ id: `code:prove:${key}`, kind: "skill_unproven", priority, title: `Show ${skill} in a bullet`, why: "Listed only in Skills. A recruiter trusts a skill they can see you used.", detail: `Names ${skill} in ${comment.target ? describeTarget(ctx.doc, comment.target) : "the role that used it"}.`, target: comment.target, fromCode: true, action: { type: "revise", comment: { ...comment, id: `code:prove:${key}` } } });
      }
    }
  }
  return items;
}

/**
 * The model's findings as actions. Code, not the model, decides:
 *  - a skill her experience doesn't have, or advice naming a tool, number or claim her experience
 *    doesn't have, becomes a question (ask_skill / ask_fact), never a change;
 *  - a skill she has but the page doesn't show becomes add_skill (free);
 *  - everything else becomes a targeted revision comment, still checked by validateResume after.
 */
export function planReviewItems(review: RecruiterReview, ctx: PlanContext): ReviewItem[] {
  const inventory = parseSkillInventory(ctx.master);
  const pageText = pageTextOf(ctx.doc);
  return review.findings.map((f): ReviewItem => {
    const quote = f.target ? spotText(ctx.doc, f.target) : "";
    const base = { id: f.id, kind: f.kind, priority: f.priority, title: f.title, why: f.why, target: f.target, quote, skill: f.skill ? normalizeSkill(f.skill) : undefined, where: f.target ? describeTarget(ctx.doc, f.target) : undefined, fromCode: false };
    if (f.skill && !hasSkill(f.skill, inventory, ctx.master)) {
      return { ...base, detail: "", action: { type: "ask_skill", skill: f.skill, question: `Have you used ${f.skill}? If yes, where?` } };
    }
    const unknown = unverifiedFacts(`${f.title} ${f.change}`, ctx.master);
    if (f.needsFact || !f.change || unknown.length) {
      const question = f.question || (unknown.length ? `This would need ${unknown.join(", ")}, which Your experience doesn't show. Is it true? If yes, tell us where.` : "Can you add the detail this needs?");
      return { ...base, detail: "", action: { type: "ask_fact", question, target: f.target, change: f.change } };
    }
    if (f.skill && SKILL_KINDS.includes(f.kind) && !hasSkill(f.skill, [], pageText)) {
      return { ...base, detail: `Adds ${f.skill} to Skills, and to a role if you pick one.`, action: { type: "add_skill", skill: f.skill } };
    }
    return { ...base, detail: f.change, action: { type: "revise", comment: { id: f.id, quote: f.target?.bullet !== undefined ? quote : "", note: revisionNote(f.change), ...(f.target ? { target: f.target } : {}) } } };
  });
}

/**
 * Code items first where the model said nothing about that skill; a model item about the same skill
 * keeps code's action (code knows what's in her experience) and adds the model's "why".
 */
export function mergeReviewItems(code: ReviewItem[], model: ReviewItem[]): ReviewItem[] {
  const skillOf = (i: ReviewItem) =>
    "skill" in i.action ? normalizeSkill(i.action.skill) : i.action.type === "revise" && i.id.startsWith("code:prove:") ? i.id.slice("code:prove:".length) : (i.skill ?? "");
  const modelBySkill = new Map<string, ReviewItem>();
  for (const m of model) {
    const s = skillOf(m);
    if (s) modelBySkill.set(s, m);
  }
  const used = new Set<string>();
  const merged = code.map((c) => {
    const m = modelBySkill.get(skillOf(c));
    if (!m) return c;
    used.add(m.id);
    return { ...c, why: m.why || c.why, priority: rankOf(m.priority) < rankOf(c.priority) ? m.priority : c.priority };
  });
  // A model item on a code-handled skill of another kind (e.g. "keyword" for a skill code already
  // asks about) is dropped too: one row per skill.
  const codeSkills = new Set(code.map(skillOf).filter(Boolean));
  const rest = model.filter((m) => !used.has(m.id) && !(skillOf(m) && codeSkills.has(skillOf(m))));
  return [...merged, ...rest].sort((a, b) => rankOf(a.priority) - rankOf(b.priority));
}

const rankOf = (p: ReviewPriority) => REVIEW_PRIORITIES.indexOf(p);

/**
 * The comment her typed answer to a fact question turns into. Her words are the source; the
 * revision is told to use them exactly, and anything new in the answer is still flagged by
 * validateResume for her to keep (decision #6).
 */
export function answerComment(item: ReviewItem, answer: string): ResumeComment {
  const target = item.action.type === "ask_fact" ? item.action.target : item.target;
  const change = item.action.type === "ask_fact" && item.action.change ? ` (${item.action.change})` : "";
  return {
    id: `answer:${item.id}`,
    quote: "",
    note: `${item.title}${change}. The candidate answered "${item.action.type === "ask_fact" ? item.action.question : ""}" with: "${answer.trim()}". Use exactly what the answer says, in their words, and nothing beyond it. Change nothing else and keep the page the same length.`,
    ...(target ? { target } : {}),
  };
}

/** A spot's text: a bullet, a skills line, or an entry's company or school. "" if the page lacks it. */
export function spotText(doc: ResumeDoc, t: Target): string {
  const flat = (x: string) => x.replace(/\*\*/g, "").replace(/\s+/g, " ").trim();
  if (t.section === "skills") return flat(doc.skills[t.entry]?.items.join(", ") ?? "");
  if (t.section === "leadership") return flat(doc.leadership[t.entry]?.role ?? "");
  const list = (t.section === "projects" ? (doc.projects ?? []) : t.section === "education" ? doc.education : doc.experience) as { bullets: string[]; company?: string; school?: string }[];
  const e = list[t.entry];
  if (!e) return "";
  if (t.bullet !== undefined) return flat(e.bullets[t.bullet] ?? "");
  return flat(e.company ?? e.school ?? "");
}

/**
 * Where an item's spot is on the page NOW. The page can change after a review (an update, a hand
 * edit, a removal), which shifts positions, so the spot is found again by its text: the same
 * position if its text is unchanged, else the spot in the same section with that text, else none
 * (a revision comment still carries the quote, so the model can find it).
 */
export function relocateTarget(doc: ResumeDoc, target: Target | undefined, quote: string | undefined): Target | undefined {
  if (!target) return undefined;
  if (!quote) return spotText(doc, target) ? target : undefined;
  if (spotText(doc, target) === quote) return target;
  const s = target.section;
  const count =
    s === "skills" ? doc.skills.length : s === "leadership" ? doc.leadership.length : (s === "projects" ? (doc.projects ?? []) : s === "education" ? doc.education : doc.experience).length;
  for (let entry = 0; entry < count; entry++) {
    if (target.bullet === undefined) {
      if (spotText(doc, { section: s, entry }) === quote) return { section: s, entry };
      continue;
    }
    const list = (s === "projects" ? (doc.projects ?? []) : s === "education" ? doc.education : s === "experience" ? doc.experience : []) as { bullets: string[] }[];
    const bullets = list[entry]?.bullets ?? [];
    for (let bullet = 0; bullet < bullets.length; bullet++) {
      if (spotText(doc, { section: s, entry, bullet }) === quote) return { section: s, entry, bullet };
    }
  }
  return undefined;
}

function pageTextOf(doc: ResumeDoc): string {
  return [
    ...doc.education.flatMap((e) => [e.degree, ...e.bullets]),
    ...[...doc.experience, ...(doc.projects ?? [])].flatMap((e) => [e.title, ...e.bullets]),
    ...doc.skills.map((s) => s.items.join(", ")),
  ]
    .join("\n")
    .replace(/\*\*/g, "");
}

function bulletTextOf(doc: ResumeDoc): string {
  return [...doc.experience, ...(doc.projects ?? [])]
    .flatMap((e) => e.bullets)
    .join("\n")
    .replace(/\*\*/g, "");
}
