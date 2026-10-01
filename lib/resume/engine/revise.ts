import type { AIProvider } from "../../ai/provider";
import { describeTarget, type Target } from "./edit";
import { ENGINE_MAX_TOKENS } from "./index";
import { buildSystemPrompt } from "./prompt";
import { RESUME_REVISION_JSON_SCHEMA, ResumeRevisionSchema, type ResumeDoc, type ResumeRevision } from "./schema";
import type { Flag } from "./validate";

// Her comments on a generated resume, sent back to the model to fix. Same system prompt as
// generation (so the cached master profile is reused), and the answer goes through the same
// validateResume() checks: anything not in the master profile is still flagged and left out
// unless she ticks it, even when her own comment asked for it.

export interface ResumeComment {
  id: string;
  /** The text she selected in the preview, or "" for a comment on the whole resume. */
  quote: string;
  note: string;
  /** The spot the comment is on (a bullet, an entry, a skills line), when the preview knows it. */
  target?: Target;
}

const JD_CHAR_LIMIT = 20000;

/**
 * The whole-resume comment behind "Fill the page": asked for only when everything the model gave
 * is already on the page and it still ends early. New content still goes through validateResume,
 * so anything not in the master profile stays off until she ticks it.
 */
export function fillPageComment(percent: number): string {
  return `The page only uses about ${percent}% of its height. Add content so it fills one page: more bullets for the roles most relevant to this job (up to 6 or 7 for the top role), taken only from that role's own lines in the MASTER PROFILE and rewritten by the rules, most relevant first; if the roles run out, add a relevant role, project or research entry from the MASTER PROFILE that isn't on the page, in reverse-chronological order. Longer bullets are fine up to two lines. Keep everything already on the page and never invent anything.`;
}

/** "On experience[1] (Brightloop, bullet 2) "…"", "On the whole resume", or "On "…"" with no target. */
function commentLine(doc: ResumeDoc, c: ResumeComment, i: number): string {
  const quote = c.quote.trim();
  const note = c.note.trim();
  if (c.target) {
    const where = `${c.target.section}[${c.target.entry}] (${describeTarget(doc, c.target)})`;
    return quote ? `${i + 1}. On ${where} "${quote}": ${note}` : `${i + 1}. On ${where}: ${note}`;
  }
  return quote ? `${i + 1}. On "${quote}": ${note}` : `${i + 1}. On the whole resume: ${note}`;
}

export function buildRevisionPrompt(company: string, jdText: string, doc: ResumeDoc, comments: ResumeComment[]): string {
  const list = comments.map((c, i) => commentLine(doc, c, i)).join("\n");
  return `Company: ${company || "(not stated)"}

Job description:
"""
${jdText.trim().slice(0, JD_CHAR_LIMIT)}
"""

This is the current tailored resume, as JSON (bold spans in bullets are marked with **). It can hold more than fits on the page: the app fits it to one page by leaving off the least relevant content, so keep each role's bullets ordered most relevant first.
${JSON.stringify(doc)}

The candidate reviewed it and left these comments:
${list}

Revise the resume to address every comment. Rules:
- Only sections 1 (HARD RULES) and 2 (BOLDING RULES) of the system prompt apply here. Do not rerun the tailoring algorithm (section 3): no re-ranking, re-selecting or rewording beyond what the comments ask.
- Change only what the comments ask for. Do not reorder, add or remove any entry, bullet or skill that no comment targets; keep every other entry, bullet, skill and date exactly as it is, word for word.
- To swap an experience for another role from the MASTER PROFILE, replace only the targeted entry. Place the new one by its dates so experience stays reverse-chronological, use its title, company, location and dates exactly as in the MASTER PROFILE, and take its bullets only from that role's own lines in the MASTER PROFILE.
- If a comment asks for something that is not in the MASTER PROFILE, use her own wording from the comment rather than inventing details; the app will ask her to confirm it.
- If a comment can't be done without breaking a hard rule, leave that part unchanged and say why in "changes".
- Return the full revised resume, and in "changes" one short line per comment, in the same order.`;
}

export async function reviseResume(
  provider: AIProvider,
  masterProfile: string,
  company: string,
  jdText: string,
  doc: ResumeDoc,
  comments: ResumeComment[],
): Promise<ResumeRevision> {
  return provider.completeJson<ResumeRevision>({
    tier: "smart",
    effort: "medium",
    maxTokens: ENGINE_MAX_TOKENS,
    system: buildSystemPrompt(masterProfile),
    cacheSystem: true,
    prompt: buildRevisionPrompt(company, jdText, doc, comments),
    schema: RESUME_REVISION_JSON_SCHEMA,
    parse: (raw) => ResumeRevisionSchema.parse(raw),
  });
}

/**
 * Flag ids are positions, which shift after a revision. A flag she already ticked stays ticked
 * when the revised resume raises the same message (same unverified fact, same wording).
 */
export function carryApprovals(previous: Flag[], approved: Set<string>, next: Flag[]): Set<string> {
  const approvedMessages = new Set(previous.filter((f) => approved.has(f.id)).map((f) => f.message));
  return new Set(next.filter((f) => approvedMessages.has(f.message)).map((f) => f.id));
}
