import type { AIProvider } from "../../ai/provider";
import { hasSkill, parseSkillInventory } from "../master/skills";
import { lintResume } from "../quality/lint";
import { issuesToComments } from "../quality/summary";
import { linesShort } from "./budget";
import type { JobFocus } from "./focus";
import { generateResume, type ConfirmedForPrompt } from "./index";
import { DEFAULT_LAYOUT } from "./layout";
import { fillComment, reviseResume, type ResumeComment } from "./revise";
import type { ResumeDoc } from "./schema";
import { fitToPage, toPoolTarget, type MeasureFn } from "./trim";
import { validateResume, type ValidationResult } from "./validate";

// One tailoring run, start to finish, at most two AI calls:
//  1. The model writes the final one-page resume to a page plan computed from the real layout
//     (budget.ts), and code checks it (validate.ts: honesty, dashes, bold, skills kept and
//     completed with the job's skills she has).
//  2. Code measures the page. Only when it ends short by a few lines, or code's writing checks
//     found something only the model can fix (a repeated verb, a buzzword, an overlong bullet),
//     ONE follow-up call asks for exactly that. If that call fails, the first draft stands.
// Overflow is never sent back: the display step (trim.ts fitResume) drops the lowest-relevance
// bullet if the page runs over, and raises the type within 10 to 11pt as the last resort.

/** A short page by fewer lines than this is left to the type size, not worth a call. */
export const MIN_SHORT_LINES = 3;

export interface TailorInput {
  provider: AIProvider;
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
}

export interface TailorOutput {
  result: ValidationResult;
  /** Plain notes on what the follow-up call did, for "What changed". */
  notes: string[];
  /** AI calls made: 1 or 2. */
  calls: number;
}

/**
 * The follow-up comments for a checked draft: one per writing fix code found, plus "add N lines"
 * when the page (at 10pt) ends MIN_SHORT_LINES or more short. Empty = no call.
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
  const short = fit.fits ? linesShort(fit.fill) : 0;
  if (short >= MIN_SHORT_LINES) comments.push({ id: "fill", quote: "", note: fillComment(short) });
  return comments;
}

export async function tailorResume(input: TailorInput): Promise<TailorOutput> {
  const { provider, master, company, jdText, focus } = input;
  const inventory = parseSkillInventory(master);
  const have = input.jobSkills.filter((s) => hasSkill(s, inventory, master));
  const gaps = input.jobSkills.filter((s) => !hasSkill(s, inventory, master));
  const checkOpts = { jobSkills: input.jobSkills, focus, addJobSkills: true };

  const raw = await generateResume(provider, master, company, jdText, { have, gaps }, focus, input.confirmed ?? []);
  let result = validateResume(raw, master, checkOpts);
  const comments = followUpComments(result, input);
  if (comments.length === 0) return { result, notes: [], calls: 1 };

  let notes: string[] = [];
  try {
    const out = await reviseResume(provider, master, company, jdText, result.doc as ResumeDoc, comments);
    const { changes, ...doc } = out;
    result = validateResume(doc, master, checkOpts);
    const fixes = comments.filter((c) => c.id !== "fill").length;
    const filled = comments.some((c) => c.id === "fill");
    const what = [fixes ? `fixed ${fixes} writing issue${fixes === 1 ? "" : "s"}` : "", filled ? "filled the rest of the page" : ""].filter(Boolean).join(" and ");
    notes = [`Polished automatically: ${what} in one extra pass.`, ...changes];
  } catch {
    // The first draft stands; she can still ask for changes.
  }
  return { result, notes, calls: 2 };
}
