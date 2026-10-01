import { z } from "zod";
import type { AIProvider, JsonSchema } from "../ai/provider";
import type { ResumeStructure } from "../docx/types";

const BulletSchema = z.object({ id: z.string(), text: z.string() });
const SkillGroupSchema = z.object({ id: z.string(), label: z.string(), items: z.array(z.string()) });
const SectionSchema = z.object({
  heading: z.string(),
  kind: z.enum(["experience", "education", "skills", "leadership", "other"]),
  context: z.string(),
  bullets: z.array(BulletSchema),
  skillGroups: z.array(SkillGroupSchema),
});
const PdfResumeSchema = z.object({
  headerText: z.string(),
  sections: z.array(SectionSchema),
});

const PDF_RESUME_JSON_SCHEMA: JsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["headerText", "sections"],
  properties: {
    headerText: { type: "string", description: "Name and contact line(s) at the top, verbatim." },
    sections: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["heading", "kind", "context", "bullets", "skillGroups"],
        properties: {
          heading: { type: "string", description: 'The section title as printed, e.g. "EXPERIENCE".' },
          kind: { type: "string", enum: ["experience", "education", "skills", "leadership", "other"] },
          context: {
            type: "string",
            description:
              "Everything in this section that is NOT a bullet or a skills line: job titles, company names, dates, locations, degree lines. One per line. This is read-only reference text, never edited.",
          },
          bullets: {
            type: "array",
            description: "Every bulleted line in this section, in order.",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["id", "text"],
              properties: {
                id: { type: "string", description: 'A short stable id you invent, e.g. "b1", "b2".' },
                text: { type: "string" },
              },
            },
          },
          skillGroups: {
            type: "array",
            description:
              'Only for the skills section: each labeled line like "Frontend: React, Next.js" becomes one entry. If a line has no bold-looking label, use label "".',
            items: {
              type: "object",
              additionalProperties: false,
              required: ["id", "label", "items"],
              properties: {
                id: { type: "string", description: 'A short stable id you invent, e.g. "s1", "s2".' },
                label: { type: "string" },
                items: { type: "array", items: { type: "string" } },
              },
            },
          },
        },
      },
    },
  },
};

const SYSTEM_PROMPT = `You read a resume PDF and return its exact structure as JSON. Copy text verbatim — never rephrase, summarize, correct, or add anything. Every bullet point becomes one entry in "bullets". Split the skills section into "skillGroups" only if it's written as labeled lines (e.g. "Frontend: React, Next.js"); otherwise put the skills line(s) in "context" and leave skillGroups empty for that section. Section "kind" should be your best classification of a standard resume section; use "other" for anything that isn't experience, education, skills or leadership (e.g. projects, summary, certifications).`;

/** Reads a PDF resume into the same ResumeStructure shape parseDocx produces, via Claude (PDFs
 * can't be parsed as XML). Bullet/skill-group ids are synthetic — there's no in-place editing
 * target, since a tailored copy of a PDF base is rebuilt from a template (see buildDocxTemplate). */
export async function parsePdfResume(provider: AIProvider, pdfBase64: string): Promise<ResumeStructure> {
  const parsed = await provider.completeJson<z.infer<typeof PdfResumeSchema>>({
    tier: "fast",
    maxTokens: 4000,
    system: SYSTEM_PROMPT,
    prompt: "Extract this resume's structure.",
    attachments: [{ mediaType: "application/pdf", base64: pdfBase64 }],
    schema: PDF_RESUME_JSON_SCHEMA,
    parse: (raw) => PdfResumeSchema.parse(raw),
  });

  const fullText = renderFullText(parsed);
  return { format: "pdf", headerText: parsed.headerText, sections: parsed.sections, fullText };
}

function renderFullText(parsed: z.infer<typeof PdfResumeSchema>): string {
  const parts = [parsed.headerText];
  for (const s of parsed.sections) {
    parts.push(s.heading);
    if (s.context) parts.push(s.context);
    for (const b of s.bullets) parts.push(`- ${b.text}`);
    for (const g of s.skillGroups) parts.push(g.label ? `${g.label}: ${g.items.join(", ")}` : g.items.join(", "));
  }
  return parts.filter(Boolean).join("\n");
}
