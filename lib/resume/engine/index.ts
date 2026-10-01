import type { AIProvider } from "../../ai/provider";
import type { Profile } from "../../types";
import type { JobFocus } from "./focus";
import { buildFocusBrief, buildSystemPrompt, buildUserPrompt, type JobSkills } from "./prompt";
import { RESUME_DOC_JSON_SCHEMA, ResumeDocSchema, type ResumeDoc, type ResumeHeader } from "./schema";

export type { ResumeDoc, ResumeHeader } from "./schema";
export type { JobSkills } from "./prompt";

/** Caps the job text sent to the model; a real posting is far shorter. */
const JD_CHAR_LIMIT = 20000;
/** Room for adaptive thinking plus a full resume's JSON. */
export const ENGINE_MAX_TOKENS = 16000;

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
 * One call to the smart model. The system prompt (rules + master profile) is cached.
 * `jobSkills`, when given, is code's have/gap split of the job's skills (matchSkills), so the model
 * uses those instead of re-deriving them. `focus`, when given, adds code's reading of the job and
 * its ranking of her experiences (prompt.ts buildFocusBrief) to the user message only, so the cached
 * system prompt stays the same for every job.
 */
export async function generateResume(
  provider: AIProvider,
  masterProfile: string,
  company: string,
  jdText: string,
  jobSkills?: JobSkills,
  focus?: JobFocus,
): Promise<ResumeDoc> {
  const brief = focus ? buildFocusBrief(focus, masterProfile, jobSkills?.have) : undefined;
  return provider.completeJson<ResumeDoc>({
    tier: "smart",
    effort: "medium",
    maxTokens: ENGINE_MAX_TOKENS,
    system: buildSystemPrompt(masterProfile),
    cacheSystem: true,
    prompt: buildUserPrompt(company, jdText.slice(0, JD_CHAR_LIMIT), jobSkills, brief),
    schema: RESUME_DOC_JSON_SCHEMA,
    parse: (raw) => ResumeDocSchema.parse(raw),
  });
}
