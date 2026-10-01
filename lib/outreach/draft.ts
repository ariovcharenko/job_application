import { z } from "zod";
import type { AIProvider, JsonSchema } from "../ai/provider";
import type { AnswerBankEntry, Application, Contact, Profile } from "../types";

const LINKEDIN_NOTE_LIMIT = 300; // LinkedIn's connection-request note character limit

const DraftSchema = z.object({ note: z.string(), followUp: z.string() });
export type OutreachDraft = z.infer<typeof DraftSchema>;

const DRAFT_JSON_SCHEMA: JsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["note", "followUp"],
  properties: {
    note: {
      type: "string",
      description: `A LinkedIn connection-request note, under ${LINKEDIN_NOTE_LIMIT} characters including spaces. Warm, specific, not generic — mentions the role or company by name. No links, no "I hope this finds you well".`,
    },
    followUp: {
      type: "string",
      description:
        "A short follow-up message (2-4 sentences) to send after they accept the connection, asking one specific question or for a brief chat. Plain text, no subject line.",
    },
  },
};

const SYSTEM_PROMPT = `You draft short, genuine outreach messages for a job seeker reaching out to someone at a company they're applying to. Use only the facts given — their real background from the answer bank/resume context, the real job and company. Never invent claims about their experience. Keep it human, specific, and brief. Never write something generic enough to paste to anyone ("I'd love to connect!") — reference the actual role or a real detail about the company/team when possible. Write the way a person types a message: plain sentences, no em dashes or en dashes, no exclamation-heavy enthusiasm, no buzzwords like "passionate" or "leverage".`;

export async function draftOutreachMessage(
  provider: AIProvider,
  contact: Pick<Contact, "name" | "role" | "type">,
  application: Pick<Application, "company" | "role" | "jdText">,
  profile: Profile,
  answerBank: AnswerBankEntry[],
): Promise<OutreachDraft> {
  const background = [
    `Name: ${profile.fullName}`,
    profile.school ? `School: ${profile.school}` : "",
    ...answerBank.slice(0, 8).map((a) => `Q: ${a.question}\nA: ${a.answer}`),
  ]
    .filter(Boolean)
    .join("\n");

  const raw = await provider.completeJson<OutreachDraft>({
    tier: "smart",
    maxTokens: 500,
    system: SYSTEM_PROMPT,
    prompt: `Company: ${application.company}\nRole they're applying for: ${application.role}\nJob posting (context only):\n"""\n${application.jdText.trim().slice(0, 4000)}\n"""\n\nPerson they're reaching out to: ${contact.name || "(name not given)"}, ${contact.role || contact.type} at ${application.company}.\n\nTheir background:\n${background}`,
    schema: DRAFT_JSON_SCHEMA,
    parse: (r) => DraftSchema.parse(r),
  });

  return {
    note: raw.note.length > LINKEDIN_NOTE_LIMIT ? raw.note.slice(0, LINKEDIN_NOTE_LIMIT - 1).trimEnd() + "…" : raw.note,
    followUp: raw.followUp,
  };
}

export { LINKEDIN_NOTE_LIMIT };
