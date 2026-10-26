import { AIError, type AIProvider } from "../../ai/provider";
import { parseMasterExperiences } from "../master/experiences";
import { hasSkill, parseSkillInventory, parseUsageNotes } from "../master/skills";
import { lintResume } from "../quality/lint";
import { issuesToComments } from "../quality/summary";
import { backfillFromExperience } from "./backfill";
import { focusRelevance, type JobFocus } from "./focus";
import { generateResume, type ConfirmedForPrompt } from "./index";
import { DEFAULT_LAYOUT } from "./layout";
import { FOLLOW_UP_EFFORT, reviseResume, type ResumeComment } from "./revise";
import type { ResumeDoc } from "./schema";
import { fitToPage, toPoolTarget, type MeasureFn } from "./trim";
import { notesForRole, validateResume, type ValidationResult } from "./validate";
import type { Target } from "./edit";

// One tailoring run, start to finish, at most two AI calls:
//  1. The model writes the final one-page resume to a page plan computed from the real layout
//     (budget.ts), and code checks it (validate.ts: honesty, dashes, bold, skills kept and
//     completed with the job's skills she has).
//  2. A short page is filled by code with her own unused bullets, word for word (backfill.ts).
//     Only when code's writing checks found something only the model can fix (a repeated verb, a
//     buzzword, an overlong bullet, a key skill not named where it was used), ONE follow-up call
//     asks for exactly that, while the draft is already on screen. If it fails, the draft stands.
// Overflow is never sent back: the display step (trim.ts fitResume) drops the lowest-relevance
// bullet if the page runs over, and raises the type within 10 to 11pt as the last resort.

export interface TailorInput {
  provider: AIProvider;
  /** For the automatic follow-up pass, so its spend is labeled apart. Defaults to `provider`. */
  polishProvider?: AIProvider;
  master: string;
  company: string;
  jdText: string;
  /** The job's skills (have and gaps), in the job's spelling. */
  jobSkills: string[];
  /** The job's required skills, most important first (for the keyword checks). */
  requiredSkills?: string[];
  focus?: JobFocus;
  /** Content height as a share of the usable page, honoring doc.layout (fit.ts pageFill in the browser). */
  measure: MeasureFn;
  /**
   * Skills she confirmed right before tailoring, and where. `master` must already include them
   * (gaps.ts applyConfirmations), so they count as hers and their placement passes the checks.
   */
  confirmed?: ConfirmedForPrompt[];
  /**
   * The checked first draft, the moment it exists, when a follow-up call is about to polish it: the
   * screen shows it right away instead of waiting for the polish. Not called when there's no follow-up.
   */
  onDraft?: (result: ValidationResult) => void;
  /** Where the run is, for the waiting screen: which step, and how much of that answer has arrived. */
  onProgress?: (p: TailorProgress) => void;
  /** Her "Cancel": stops whichever call is running. */
  signal?: AbortSignal;
}

export interface TailorProgress {
  step: "writing" | "polishing";
  /** Characters of the model's answer so far; 0 while it is still thinking. */
  chars: number;
}

export interface TailorOutput {
  result: ValidationResult;
  /** Plain notes on what the follow-up call did, for "What changed". */
  notes: string[];
  /** AI calls made: 1 or 2. */
  calls: number;
}

/** At most this many of the job's skills are sent back to be worked into bullets, most important first. */
export const MAX_KEYWORD_ASKS = 6;

/**
 * The job's most important skills she has that the page shows only in Skills (no bullet names
 * them), although a role or project on the page truly used them (its own text in the master
 * profile, or a usage note tied to it). One comment per entry, asking to name them in that entry's
 * bullets. A skill no entry on the page shows stays in Skills only: putting it in a bullet would
 * be invented.
 */
export function keywordComments(doc: ResumeDoc, master: string, skills: string[]): ResumeComment[] {
  const entries = parseMasterExperiences(master);
  const notes = parseUsageNotes(master);
  const plain = (b: string) => b.replace(/\*\*/g, "");
  const onPage = (["experience", "projects"] as const).flatMap((section) =>
    (doc[section] ?? []).map((e, entry) => {
      const m = entries.find((x) => x.company.toLowerCase() === e.company.toLowerCase());
      const extra = notesForRole(notes, e.company, m?.title).map((n) => `${n.skill}: ${n.where}`);
      return { section, entry, label: e.company, bullets: e.bullets.map(plain).join("\n"), source: m ? [m.block, ...extra].join("\n") : "" };
    }),
  );
  const seen = new Set<string>();
  const wanted = skills.filter((s) => {
    const k = s.trim().toLowerCase();
    if (!k || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  const asks = new Map<string, { target: Target; label: string; skills: string[] }>();
  let count = 0;
  for (const skill of wanted) {
    if (count >= MAX_KEYWORD_ASKS) break;
    if (onPage.some((e) => hasSkill(skill, [], e.bullets))) continue;
    const home = onPage.find((e) => e.source && hasSkill(skill, [], e.source));
    if (!home) continue;
    const key = `${home.section}:${home.entry}`;
    const ask = asks.get(key) ?? { target: { section: home.section, entry: home.entry }, label: home.label, skills: [] };
    ask.skills.push(skill);
    asks.set(key, ask);
    count++;
  }
  return [...asks.values()].map((a) => {
    const list = a.skills.join(", ");
    const one = a.skills.length === 1;
    return {
      id: `keywords:${a.target.section}:${a.target.entry}`,
      quote: "",
      target: a.target,
      note: `The job asks for ${list}, and the MASTER PROFILE's text for ${a.label} shows ${one ? "it" : "them"}, but no bullet names ${one ? "it" : "them"} yet (only the Skills section does). Rewrite the most fitting bullet${one ? "" : "s"} of this entry to name ${list} in the job's spelling, where ${one ? "it was" : "each was"} really used, as a natural part of the sentence (not a list tacked on the end). Change nothing else and keep the page the same length.`,
    };
  });
}

/**
 * The follow-up comments for a checked draft: one per writing fix code found, plus the job's key
 * skills to name in the bullets of the roles that used them. Empty = no call.
 */
export function followUpComments(result: ValidationResult, input: Pick<TailorInput, "jobSkills" | "requiredSkills" | "measure" | "master">): ResumeComment[] {
  const inventory = parseSkillInventory(input.master);
  const have = input.jobSkills.filter((s) => hasSkill(s, inventory, input.master));
  // Measured with every line on it (a blocked line shows struck through until she decides), the
  // same page the preview shows, so the spots below line up with the document.
  const fit = fitToPage(result.doc, (d) => input.measure({ ...d, layout: DEFAULT_LAYOUT }), { restore: false });
  const fixes = lintResume(fit.doc, { jobSkills: have, requiredSkills: input.requiredSkills ?? [] }).filter((i) => i.severity === "fix");
  // Issues are found on the measured page; the call is sent the whole document, so map each spot back.
  const comments: ResumeComment[] = issuesToComments(fixes).map((c) => {
    const target = c.target ? toPoolTarget(fit.map, c.target) : null;
    return { ...c, target: target ?? undefined };
  });
  // The job's key skills she has, required first: each one a role on the page really used should be
  // named in a bullet, not only listed under Skills (recruiters and ATS both read bullets).
  const key = [...(input.requiredSkills ?? []), ...have].filter((s) => have.some((h) => h.toLowerCase() === s.toLowerCase()));
  for (const c of keywordComments(fit.doc, input.master, key)) {
    const target = c.target ? toPoolTarget(fit.map, c.target) : null;
    if (target) comments.push({ ...c, target });
  }
  // A short page is no longer sent back: code fills it from her own bullets (tailorResume), and the
  // display step raises the type a little for the rest.
  return comments;
}

/** Bullets under roles and projects: the body of the page. */
const bodyBullets = (d: ResumeDoc) => [...d.experience, ...(d.projects ?? [])].reduce((n, e) => n + e.bullets.length, 0);

/**
 * An answer that parses but has nothing to show (no role or project has a bullet) would render as a
 * header and a skills list: a blank page. That is reported as an error with a next step instead.
 */
export function assertUsable(doc: ResumeDoc): void {
  if (bodyBullets(doc) === 0) {
    throw new AIError(
      "invalid_output",
      "The model sent back a resume with no experience bullets. Try again. If it keeps happening, check that your experience (Resumes page) lists roles with bullet points.",
    );
  }
}

export async function tailorResume(input: TailorInput): Promise<TailorOutput> {
  const { provider, master, company, jdText, focus } = input;
  const inventory = parseSkillInventory(master);
  const have = input.jobSkills.filter((s) => hasSkill(s, inventory, master));
  const gaps = input.jobSkills.filter((s) => !hasSkill(s, inventory, master));
  const checkOpts = { jobSkills: input.jobSkills, focus, addJobSkills: true };

  const progress = (step: TailorProgress["step"]) => (input.onProgress ? (chars: number) => input.onProgress!({ step, chars }) : undefined);
  input.onProgress?.({ step: "writing", chars: 0 });
  const raw = await generateResume(provider, master, company, jdText, { have, gaps }, focus, input.confirmed ?? [], progress("writing"), input.signal);
  assertUsable(raw);
  let result = validateResume(raw, master, checkOpts);
  // A page that comes back short is filled by code with her own unused bullets of the roles on it,
  // word for word (true by construction, free, instant); the fit step keeps the most relevant that
  // fit. Asking the model to "add N lines" split good bullets in half and repeated content (live
  // gpt-5 run, 2026-10-25), and was the slowest call of the run.
  const fill = backfillFromExperience(result.doc as ResumeDoc, master, focus ? focusRelevance(focus) : undefined);
  const filledNote = fill.added ? [`Added ${fill.added} more of your own bullets, word for word, so the page can be filled with the most relevant.`] : [];
  if (fill.added) result = validateResume(fill.doc, master, checkOpts);
  const comments = followUpComments(result, input);
  if (comments.length === 0) return { result, notes: filledNote, calls: 1 };

  let notes: string[] = [...filledNote];
  const draft = result;
  input.onDraft?.(draft);
  try {
    input.onProgress?.({ step: "polishing", chars: 0 });
    const out = await reviseResume(input.polishProvider ?? provider, master, company, jdText, result.doc as ResumeDoc, comments, progress("polishing"), FOLLOW_UP_EFFORT, input.signal);
    const { changes, ...doc } = out;
    // A follow-up that came back empty or much shorter than the draft is worse than no follow-up.
    if (bodyBullets(doc) === 0 || bodyBullets(doc) < bodyBullets(result.doc as ResumeDoc) * 0.7) throw new Error("unusable follow-up");
    const revised = validateResume(doc, master, checkOpts);
    const keywords = comments.filter((c) => c.id.startsWith("keywords:")).length;
    const fixes = comments.filter((c) => c.id !== "fill" && !c.id.startsWith("keywords:")).length;
    const filled = comments.some((c) => c.id === "fill");
    const what = [
      fixes ? `fixed ${fixes} writing issue${fixes === 1 ? "" : "s"}` : "",
      keywords ? "named the job's key skills in the bullets where you used them" : "",
      filled ? "filled the rest of the page" : "",
    ]
      .filter(Boolean)
      .join(", ")
      .replace(/, ([^,]*)$/, " and $1");
    result = revised;
    notes = [`Polished automatically: ${what} in one extra pass.`, ...filledNote, ...changes];
  } catch (e) {
    // Her Cancel stops the whole run, unless the draft is already on screen: then Cancel only skips
    // the polish and the draft stays. Any other failure leaves the first draft standing too.
    if (input.signal?.aborted && !input.onDraft) throw e;
    return { result: draft, notes: filledNote, calls: 2 };
  }
  return { result, notes, calls: 2 };
}
