import type { AIProvider } from "../../ai/provider";
import { CHARS_PER_LINE } from "./budget";
import { describeTarget, type Target } from "./edit";
import { ENGINE_MAX_TOKENS } from "./index";
import { buildSystemPrompt } from "./prompt";
import { RESUME_REVISION_JSON_SCHEMA, ResumeRevisionSchema, type ResumeDoc, type ResumeRevision } from "./schema";
import type { Flag } from "./validate";

// Changes to a generated resume, sent back to the model in one call: what she asks for in the
// "Ask for changes" box, notes she left on a line of the preview, skills she placed in a role, and
// (right after generation) the writing fixes and missing lines code found. Same system prompt as
// generation (so the cached master profile is reused), and the answer goes through the same
// validateResume() checks: anything not in the master profile is still blocked until she keeps it.

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
 * "medium": a revision changes a few targeted spots, so it doesn't need generation's long think,
 * and she is waiting on it (about 30 seconds at medium; the old high effort took minutes).
 */
export const REVISE_EFFORT = "medium" as const;

/** One-click requests in the "Ask for changes" box. Each runs right away as one revision. */
export const CHANGE_CHIPS: { label: string; note: string }[] = [
  { label: "More backend focus", note: "Lead with the backend work: APIs, services, databases and infrastructure, where the roles truly show it. Keep the page the same length." },
  { label: "Shorter bullets", note: "Tighten every bullet: cut filler words so most bullets fit on one line, keeping each number and main technology. Use the room for one more strong bullet where a role has more in my experience." },
  { label: "Emphasize leadership", note: "Bring out ownership and leadership that my experience truly shows (owning features end to end, design docs, mentoring, leading sections). Never upgrade scope or title." },
  { label: "Use the job's keywords", note: "Use the job description's exact wording for skills and work I truly have, in bullets and skills, wherever it means the same thing. Never add a gap." },
];

/** The comment asking for N more lines of content when the measured page ends short. */
export function fillComment(lines: number): string {
  return `The page ends about ${lines} line${lines === 1 ? "" : "s"} short of a full page. Add about ${lines} line${lines === 1 ? "" : "s"} of the most relevant content for this job: another bullet (or a fuller second line on an existing one) for the most relevant roles, taken only from that role's own text in the MASTER PROFILE. A line holds about ${CHARS_PER_LINE} characters. Keep everything already on the page and never invent anything.`;
}

/** The comment asking for a skill she placed in a role to be shown in that role's bullets. */
export function placementComment(skill: string, how: string, target: Target | undefined, placeLabel: string): ResumeComment {
  const role = target ? "this role" : placeLabel;
  const note = how.trim()
    ? `I used ${skill} in ${role}: ${how.trim()}. Work ${skill} into the most fitting bullet of ${role} (or rewrite one bullet to show it), saying only what is true from that role's text and this note.`
    : `I used ${skill} in ${role}. Work ${skill} into the most fitting bullet of ${role}, where it truly belongs with that work, without inventing any scope, number or result.`;
  return { id: `place:${skill}:${placeLabel}`, quote: "", note: `${note} Keep the page the same length.`, ...(target ? { target } : {}) };
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

This is the current tailored resume, as JSON (bold spans in bullets are marked with **). It is the finished one-page resume: keep it about the same length unless a comment asks for more or less.
${JSON.stringify(doc)}

The candidate asked for these changes:
${list}

Revise the resume to do every one of them. Rules:
- Every rule in the system prompt still applies (truth, the job's words only for the same thing, bolding, no dashes, every skill kept). There is no PAGE PLAN here; the page as it is sets the length.
- Change only what the comments ask for. Keep every other entry, bullet, skill and date exactly as it is, word for word.
- To swap an experience for another role from the MASTER PROFILE, replace only the targeted entry. Place the new one by its dates so experience stays reverse-chronological, use its title, company, location and dates exactly as in the MASTER PROFILE, and take its bullets only from that role's own text.
- If a comment asks for something that is not in the MASTER PROFILE, use the candidate's own wording from the comment rather than inventing details; the app will ask them to confirm it.
- If a comment can't be done without breaking a rule, leave that part unchanged and say why in "changes".
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
    effort: REVISE_EFFORT,
    maxTokens: ENGINE_MAX_TOKENS,
    system: buildSystemPrompt(masterProfile),
    cacheSystem: true,
    prompt: buildRevisionPrompt(company, jdText, doc, comments),
    schema: RESUME_REVISION_JSON_SCHEMA,
    parse: (raw) => ResumeRevisionSchema.parse(raw),
  });
}

/**
 * Flag ids are positions, which shift after a revision. A flag she already kept stays kept
 * when the revised resume raises the same message (same unverified fact, same wording).
 */
export function carryApprovals(previous: Flag[], approved: Set<string>, next: Flag[]): Set<string> {
  const approvedMessages = new Set(previous.filter((f) => approved.has(f.id)).map((f) => f.message));
  return new Set(next.filter((f) => approvedMessages.has(f.message)).map((f) => f.id));
}
