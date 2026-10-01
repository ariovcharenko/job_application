import { z } from "zod";
import type { AIProvider, JsonSchema } from "../ai/provider";

export interface BaseResumeChoice {
  id: number;
  label: string;
}

export const CLASSIFY_JD_CHAR_LIMIT = 8000;
export const CLASSIFY_MAX_TOKENS = 300;

const ClassifySchema = z.object({ baseResumeId: z.number(), reason: z.string() });

function schemaFor(ids: number[]): JsonSchema {
  return {
    type: "object",
    additionalProperties: false,
    required: ["baseResumeId", "reason"],
    properties: {
      baseResumeId: { type: "integer", enum: ids, description: "The id of the best-matching base resume." },
      reason: { type: "string", description: "One short sentence on why this resume fits the job best." },
    },
  };
}

/** Picks the best-matching base resume for a job description. Skips the AI call entirely when
 * there's only one candidate — no point spending money to "choose" among one option. */
export async function classifyBaseResume(
  provider: AIProvider,
  jdText: string,
  candidates: BaseResumeChoice[],
): Promise<{ baseResumeId: number; reason: string }> {
  if (candidates.length === 0) throw new Error("No base resumes to choose from.");
  if (candidates.length === 1) return { baseResumeId: candidates[0].id, reason: "Only base resume available." };

  const list = candidates.map((c) => `- id ${c.id}: ${c.label}`).join("\n");
  return provider.completeJson({
    tier: "fast",
    maxTokens: CLASSIFY_MAX_TOKENS,
    system:
      "You pick the best-matching resume for a job posting from a short list of labeled options (e.g. SWE, AI Engineer, Product, UX/UI). Judge by role type and required skills, not seniority wording.",
    prompt: `Job posting:\n"""\n${jdText.trim().slice(0, CLASSIFY_JD_CHAR_LIMIT)}\n"""\n\nCandidate resumes:\n${list}`,
    schema: schemaFor(candidates.map((c) => c.id)),
    parse: (raw) => ClassifySchema.parse(raw),
  });
}
