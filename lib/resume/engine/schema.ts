import { z } from "zod";
import type { JsonSchema } from "../../ai/provider";

// The tailored resume as the model returns it. The header (name + contact links) is NOT part of
// this: it's built by code from the Profile so the links can never be mistyped or "fixed".
// Bullet text marks bold spans with **double asterisks**.

const EntrySchema = z.object({
  title: z.string(),
  company: z.string(),
  location: z.string(),
  dates: z.string(),
  bullets: z.array(z.string()),
});

/** Body font size (pt) and line/section spacing multiple the page was fitted at (lib/resume/engine/layout.ts). */
export const LayoutSchema = z.object({ body: z.number(), spacing: z.number() });

export const ResumeDocSchema = z.object({
  education: z.array(
    z.object({
      school: z.string(),
      location: z.string(),
      degree: z.string(),
      dates: z.string(),
      bullets: z.array(z.string()),
    }),
  ),
  experience: z.array(EntrySchema),
  /** Entries from the master profile's Projects section, same shape as a role (company = project name). */
  projects: z.array(EntrySchema).optional(),
  skills: z.array(z.object({ category: z.string(), items: z.array(z.string()) })),
  leadership: z.array(z.object({ role: z.string(), dates: z.string() })),
  meta: z.object({
    matchedKeywords: z.array(z.string()),
    gaps: z.array(z.string()),
    valuesReflected: z.array(z.string()),
    /** Hard requirements she may not meet (graduation window, years, location, authorization, degree), one sentence each. */
    warnings: z.array(z.string()).optional(),
  }),
  /** Set by code when fitting the page, never by the model. Absent = DEFAULT_LAYOUT. */
  layout: LayoutSchema.optional(),
});

export type ResumeDoc = z.infer<typeof ResumeDocSchema>;

export interface ResumeHeader {
  name: string;
  location: string;
  links: { text: string; url: string }[];
}

const str = { type: "string" } as const;
const strArr = { type: "array", items: { type: "string" } } as const;
const obj = (properties: Record<string, unknown>) => ({
  type: "object",
  additionalProperties: false,
  required: Object.keys(properties),
  properties,
});

// Mirrors ResumeDocSchema for Anthropic structured outputs (which needs plain JSON Schema).
const RESUME_DOC_PROPERTIES = {
  education: {
    type: "array",
    items: obj({ school: str, location: str, degree: str, dates: str, bullets: strArr }),
  },
  experience: {
    type: "array",
    description: "3 to 4 entries in reverse-chronological order.",
    items: obj({
      title: str,
      company: str,
      location: str,
      dates: str,
      bullets: {
        ...strArr,
        description:
          "Every bullet of this role's MASTER PROFILE entry that has any relevance to this job, each rewritten for it, most relevant first (at least 6 for the most relevant role when the source has them). The app leaves off the last ones of the least relevant roles if the page is full.",
      },
    }),
  },
  projects: {
    type: "array",
    description: "Entries from the MASTER PROFILE's Projects section only (company = the project's name), at most 2 bullets each. Empty if it has none.",
    items: obj({ title: str, company: str, location: str, dates: str, bullets: strArr }),
  },
  skills: {
    type: "array",
    description: "5 to 6 lines, the categories the job cares about most first. Items only from the skills inventory.",
    items: obj({ category: str, items: strArr }),
  },
  leadership: { type: "array", items: obj({ role: str, dates: str }) },
  meta: obj({
    matchedKeywords: { ...strArr, description: "The job's main keywords that appear on the page, in the job's spelling. Brief is fine." },
    gaps: { ...strArr, description: "Skills the job asks for that are not in the master profile. Never put these on the page. Brief is fine." },
    valuesReflected: { ...strArr, description: "Company values reflected through word choice." },
    warnings: {
      ...strArr,
      description:
        "One sentence per hard requirement in the job the candidate may not meet (graduation window, years of experience, location or onsite, work authorization, degree level), or a conflict in the master profile. Empty if none.",
    },
  }),
};

export const RESUME_DOC_JSON_SCHEMA: JsonSchema = obj(RESUME_DOC_PROPERTIES);

/** A revision: the full updated resume plus one line per comment saying what was done. */
export const ResumeRevisionSchema = ResumeDocSchema.extend({ changes: z.array(z.string()) });
export type ResumeRevision = z.infer<typeof ResumeRevisionSchema>;

export const RESUME_REVISION_JSON_SCHEMA: JsonSchema = obj({
  ...RESUME_DOC_PROPERTIES,
  changes: { ...strArr, description: "One short line per comment, in order, saying what you changed (or why you couldn't)." },
});
