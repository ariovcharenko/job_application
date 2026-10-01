import { z } from "zod";
import type { AIProvider, JsonSchema } from "../ai/provider";

export const VISA_SIGNAL_VALUES = ["unknown", "sponsors", "opt-friendly", "no-sponsorship"] as const;
export const FRESHNESS_VALUES = ["within_24h", "within_week", "older", "unknown"] as const;
export const WORK_MODE_VALUES = ["Remote", "Hybrid", "On-site", "Unknown"] as const;
export const OPT_SIGNAL_VALUES = ["welcomes-opt", "excludes-opt", "unknown"] as const;
export const DEGREE_LEVEL_VALUES = ["none", "associate", "bachelors", "masters", "phd"] as const;

const JobSignalsSchema = z.object({
  company: z.string(),
  role: z.string(),
  location: z.string(),
  workMode: z.enum(WORK_MODE_VALUES),
  salary: z.string(),
  seniority: z.string(),
  mustHaveSkills: z.array(z.string()),
  niceToHaveSkills: z.array(z.string()),
  visaSignal: z.enum(VISA_SIGNAL_VALUES),
  visaEvidence: z.string(),
  citizenshipRequired: z.boolean(),
  clearanceRequired: z.boolean(),
  freshness: z.enum(FRESHNESS_VALUES),
  freshnessEvidence: z.string(),
  optSignal: z.enum(OPT_SIGNAL_VALUES),
  optEvidence: z.string(),
  /** Minimum years of professional experience asked for, or -1 when the posting doesn't say. */
  minYearsExperience: z.number().int(),
  /** The minimum degree the posting requires ("none" when it doesn't require one or doesn't say). */
  degreeRequired: z.enum(DEGREE_LEVEL_VALUES),
});

export type JobSignals = z.infer<typeof JobSignalsSchema>;

// Mirrors JobSignalsSchema. Anthropic's structured-output feature needs a plain JSON Schema,
// not a zod schema, so the two are kept in step by hand.
const JOB_SIGNALS_JSON_SCHEMA: JsonSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "company",
    "role",
    "location",
    "workMode",
    "salary",
    "seniority",
    "mustHaveSkills",
    "niceToHaveSkills",
    "visaSignal",
    "visaEvidence",
    "citizenshipRequired",
    "clearanceRequired",
    "freshness",
    "freshnessEvidence",
    "optSignal",
    "optEvidence",
    "minYearsExperience",
    "degreeRequired",
  ],
  properties: {
    company: { type: "string", description: "The hiring company's name, or \"\" if not stated." },
    role: { type: "string", description: "The job title as written." },
    location: { type: "string", description: "The location exactly as stated, e.g. \"Irvine, CA\" or \"Remote (US)\"." },
    workMode: { type: "string", enum: [...WORK_MODE_VALUES] },
    salary: { type: "string", description: "The salary or pay range as stated, or \"\" if not mentioned." },
    seniority: { type: "string", description: "e.g. \"New grad\", \"Entry level\", \"Senior\", or \"\" if not stated." },
    mustHaveSkills: {
      type: "array",
      items: { type: "string" },
      description:
        "Required technical skills: languages, frameworks, tools, platforms, technical areas (e.g. \"Swift\", \"React\", \"distributed systems\"). Short names only. Never personality traits or soft skills (communication, attention to detail, positive attitude, teamwork).",
    },
    niceToHaveSkills: { type: "array", items: { type: "string" }, description: "Preferred but not required technical skills, same rules as mustHaveSkills." },
    visaSignal: {
      type: "string",
      enum: [...VISA_SIGNAL_VALUES],
      description:
        '"sponsors" only if the text says it sponsors work visas. "opt-friendly" if it welcomes CPT/OPT/STEM OPT or says it uses E-Verify for students. "no-sponsorship" only if the text rules out sponsorship or requires citizenship/permanent residency. Otherwise "unknown" — never guess.',
    },
    visaEvidence: { type: "string", description: "The exact quote behind visaSignal, or \"\" if unknown." },
    citizenshipRequired: { type: "boolean", description: "True only if US citizenship is explicitly required." },
    clearanceRequired: { type: "boolean", description: "True only if a security clearance is explicitly required." },
    freshness: {
      type: "string",
      enum: [...FRESHNESS_VALUES],
      description: "How recently this was posted, judged against today's date given in the instructions.",
    },
    freshnessEvidence: { type: "string", description: "The text this was based on (e.g. \"Posted 2 days ago\"), or \"\" if unknown." },
    optSignal: {
      type: "string",
      enum: [...OPT_SIGNAL_VALUES],
      description:
        '"welcomes-opt" only if the text explicitly welcomes F-1 students on OPT/CPT/STEM OPT. "excludes-opt" only if it explicitly rules out OPT/CPT, or requires candidates to be authorized to work without sponsorship now AND in the future, or requires citizenship/permanent residency. Otherwise "unknown" — never guess.',
    },
    optEvidence: { type: "string", description: "The exact quote behind optSignal, or \"\" if unknown." },
    minYearsExperience: {
      type: "integer",
      description: "The minimum years of professional experience required (e.g. 3 for \"3+ years\"). 0 if it says new grads/no experience are welcome. -1 if not stated.",
    },
    degreeRequired: {
      type: "string",
      enum: [...DEGREE_LEVEL_VALUES],
      description:
        'The minimum degree explicitly required. "none" if no degree is required or none is mentioned. A degree that is only "preferred" does not count, and a degree "or equivalent experience" (or "or equivalent practical experience") counts as "none".',
    },
  },
};

const SYSTEM_PROMPT = (today: string) => `You extract structured facts from a job posting. Only use what the text says or strongly implies. When something is not stated, use "" for text, an empty array for lists, false for booleans, and "unknown" for the visa signal and freshness — never guess.

Today's date is ${today}. Use it only to classify how recently the job was posted, from wording like "posted 2 days ago", "posted this week", or an explicit date. If no posting date is mentioned or implied, use "unknown".

Sponsorship rules, applied strictly:
- "sponsors": the text says it sponsors work visas (e.g. H-1B sponsorship available).
- "opt-friendly": the text welcomes CPT/OPT/STEM OPT, or says it participates in E-Verify in a way aimed at student work authorization.
- "no-sponsorship": the text explicitly rules out sponsorship, or requires US citizenship or permanent residency.
- "unknown": anything else, including when the posting simply says nothing about it. Do not infer "sponsors" just because a company is large or well known.

OPT rules (separate from sponsorship), applied just as strictly:
- "welcomes-opt": the text explicitly welcomes F-1 students on OPT, CPT or STEM OPT.
- "excludes-opt": the text explicitly rules out OPT/CPT, says candidates must be authorized to work without sponsorship now and in the future, or requires US citizenship or permanent residency.
- "unknown": anything else.

Degree: report the minimum degree the text requires. If it accepts equivalent experience instead ("Bachelor's degree or equivalent experience"), or only prefers a degree, use "none".`;

// Keep prompts (and cost) bounded against an accidental paste of an entire page.
const MAX_JD_CHARS = 20000;

/**
 * Extracts structured signals from a job description with the "fast" model. The model never
 * computes a score — lib/scoring/score.ts turns these signals into a number deterministically.
 */
export async function extractJobSignals(provider: AIProvider, jdText: string, today: string): Promise<JobSignals> {
  const text = jdText.trim().slice(0, MAX_JD_CHARS);
  return provider.completeJson<JobSignals>({
    tier: "fast",
    maxTokens: 2000,
    system: SYSTEM_PROMPT(today),
    prompt: `Job posting:\n"""\n${text}\n"""`,
    schema: JOB_SIGNALS_JSON_SCHEMA,
    parse: (raw) => JobSignalsSchema.parse(raw),
  });
}
