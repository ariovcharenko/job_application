import type { AIProvider } from "../../ai/provider";
import type { Profile } from "../../types";
import type { JobFocus } from "./focus";
import { buildBrief, buildSystemPrompt, buildUserPrompt, type ConfirmedForPrompt, type JobSkills } from "./prompt";
import { RESUME_DOC_JSON_SCHEMA, ResumeDocSchema, type ResumeDoc, type ResumeHeader } from "./schema";

export type { ResumeDoc, ResumeHeader } from "./schema";
export type { ConfirmedForPrompt, JobSkills } from "./prompt";

/** Caps the job text sent to the model; a real posting is far shorter. */
const JD_CHAR_LIMIT = 20000;
/**
 * Room for adaptive thinking at effort high plus a full resume's JSON. The SDK refuses a
 * non-streaming request above ~21,333 max tokens (its 10-minute rule), so this stays under it.
 */
export const ENGINE_MAX_TOKENS = 20000;

const withScheme = (url: string) => (/^https?:\/\//i.test(url) ? url : `https://${url}`);

/**
 * The header comes from the Profile, never from the model, so the contact links are always the
 * exact URLs she saved. Only links she has filled in are shown.
 */
export function buildHeader(p: Profile): ResumeHeader {
  const links: ResumeHeader["links"] = [];
  if (p.email.trim()) links.push({ text: p.email.trim(), url: `mailto:${p.email.trim()}` });
  if (p.linkedin.trim()) links.push({ text: "LinkedIn", url: withScheme(p.linkedin.trim()) });
  if (p.github.trim()) links.push({ text: "GitHub", url: withScheme(p.github.trim()) });
  if (p.portfolio.trim()) links.push({ text: "Portfolio", url: withScheme(p.portfolio.trim()) });
  // Each URL once: a link saved in two fields (say GitHub also as Portfolio) shows once.
  const seen = new Set<string>();
  const unique = links.filter((l) => {
    const key = l.url.toLowerCase().replace(/\/+$/, "");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return { name: p.fullName.trim(), location: p.location.trim(), links: unique };
}

/**
 * How hard the model thinks when writing the page. "high": the model now writes the final page
 * itself (one call, no code-side cutting and padding), so its first answer is what she sees; the
 * extra thinking is where the quality of a hand-tailored page comes from. Revisions stay at
 * "medium" (revise.ts): they change a few targeted spots and should come back in seconds.
 */
export const GENERATE_EFFORT = "high" as const;

/**
 * One call to the smart model writes the final one-page resume. The system prompt (rules + master
 * profile) is cached. `jobSkills`, when given, is code's have/gap split of the job's skills
 * (matchSkills), so the model uses those instead of re-deriving them. The user message also carries
 * the page plan (budget.ts: which roles, how many bullets each, from the real layout) and, when
 * `focus` is given, code's reading of the job (prompt.ts buildBrief), so the cached system prompt
 * stays the same for every job.
 */
export async function generateResume(
  provider: AIProvider,
  masterProfile: string,
  company: string,
  jdText: string,
  jobSkills?: JobSkills,
  focus?: JobFocus,
  confirmed: ConfirmedForPrompt[] = [],
): Promise<ResumeDoc> {
  const brief = buildBrief(masterProfile, focus, jobSkills?.have);
  return provider.completeJson<ResumeDoc>({
    tier: "smart",
    effort: GENERATE_EFFORT,
    maxTokens: ENGINE_MAX_TOKENS,
    system: buildSystemPrompt(masterProfile),
    cacheSystem: true,
    prompt: buildUserPrompt(company, jdText.slice(0, JD_CHAR_LIMIT), jobSkills, brief, confirmed),
    schema: RESUME_DOC_JSON_SCHEMA,
    parse: (raw) => ResumeDocSchema.parse(raw),
  });
}
