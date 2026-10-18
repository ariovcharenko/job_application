import { describe, expect, it, vi } from "vitest";
import type { AIProvider, JsonOptions } from "../ai/provider";
import type { AnswerBankEntry, Profile } from "../types";
import { DRAFT_JSON_SCHEMA, draftOutreachMessage, fitNote, LINKEDIN_NOTE_LIMIT, plainDashes } from "./draft";

function fakeProvider(response: unknown): { provider: AIProvider; completeJson: ReturnType<typeof vi.fn> } {
  const completeJson = vi.fn(async <T,>(opts: JsonOptions<T>) => opts.parse!(response));
  return {
    provider: { id: "fake", complete: vi.fn(), completeJson: completeJson as AIProvider["completeJson"], listModels: vi.fn(), testConnection: vi.fn() },
    completeJson,
  };
}

const profile = { fullName: "Alex Rivera", school: "Lakeside University" } as Profile;
const answerBank: AnswerBankEntry[] = [{ question: "Why this company?", answer: "I admire their engineering blog.", tags: [] }];
const application = { company: "Stripe", role: "SWE Intern", jdText: "We build payments infrastructure." };
const contact = { name: "Jane Doe", role: "Recruiter", type: "recruiter" as const };

describe("draftOutreachMessage", () => {
  it("returns the note and follow-up as given when the note is within the limit", async () => {
    const { provider } = fakeProvider({ note: "Hi Jane, would love to connect about the SWE Intern role!", followUp: "Thanks for connecting..." });
    const result = await draftOutreachMessage(provider, contact, application, profile, answerBank);
    expect(result.note).toBe("Hi Jane, would love to connect about the SWE Intern role!");
    expect(result.followUp).toBe("Thanks for connecting...");
  });

  it("truncates a note that exceeds LinkedIn's character limit", async () => {
    const { provider } = fakeProvider({ note: "x".repeat(LINKEDIN_NOTE_LIMIT + 50), followUp: "..." });
    const result = await draftOutreachMessage(provider, contact, application, profile, answerBank);
    expect(result.note.length).toBeLessThanOrEqual(LINKEDIN_NOTE_LIMIT);
  });

  it("includes the company, role and her background in the prompt", async () => {
    const { provider, completeJson } = fakeProvider({ note: "note", followUp: "follow" });
    await draftOutreachMessage(provider, contact, application, profile, answerBank);
    const opts = completeJson.mock.calls[0][0] as JsonOptions<unknown>;
    expect(opts.prompt).toContain("Stripe");
    expect(opts.prompt).toContain("SWE Intern");
    expect(opts.prompt).toContain("I admire their engineering blog.");
    expect(opts.tier).toBe("smart");
  });

  it("keeps the note within the limit after dash cleanup, cutting at a word", async () => {
    const long = ("Hi Jane, I applied to the SWE Intern role \u2014 and I read your team's blog. ").repeat(6);
    const { provider } = fakeProvider({ note: long, followUp: "Thanks \u2014 would a short chat work?" });
    const result = await draftOutreachMessage(provider, contact, application, profile, answerBank);
    expect(result.note.length).toBeLessThanOrEqual(LINKEDIN_NOTE_LIMIT);
    expect(result.note).toMatch(/\w\u2026$/);
    expect(result.note).not.toMatch(/[\u2013\u2014]/);
    expect(result.followUp).toBe("Thanks, would a short chat work?");
  });
});

describe("plainDashes", () => {
  it("turns punctuation dashes into commas and ranges into hyphens", () => {
    expect(plainDashes("Loved the post \u2014 really clear.")).toBe("Loved the post, really clear.");
    expect(plainDashes("Loved the post\u2014really clear.")).toBe("Loved the post, really clear.");
    expect(plainDashes("Free for 2\u20134 minutes")).toBe("Free for 2-4 minutes");
    expect(plainDashes("Thanks \u2014.")).toBe("Thanks.");
    expect(plainDashes("No dashes here - ok")).toBe("No dashes here - ok");
  });
});

describe("fitNote", () => {
  it("leaves a short note alone and never exceeds the limit", () => {
    expect(fitNote("short")).toBe("short");
    expect(fitNote("x".repeat(400)).length).toBeLessThanOrEqual(LINKEDIN_NOTE_LIMIT);
    expect(fitNote("word ".repeat(100)).length).toBeLessThanOrEqual(LINKEDIN_NOTE_LIMIT);
  });
});

describe("outreach JSON contract", () => {
  it("fits OpenAI's strict JSON Schema rules: closed object, every property required, plain string types", () => {
    expect(DRAFT_JSON_SCHEMA.type).toBe("object");
    expect(DRAFT_JSON_SCHEMA.additionalProperties).toBe(false);
    const props = DRAFT_JSON_SCHEMA.properties as Record<string, { type: string }>;
    expect([...(DRAFT_JSON_SCHEMA.required as string[])].sort()).toEqual(Object.keys(props).sort());
    for (const p of Object.values(props)) expect(p.type).toBe("string");
    // Strict mode rejects length keywords, so the 300-char limit lives in code (fitNote), not here.
    expect(JSON.stringify(DRAFT_JSON_SCHEMA)).not.toMatch(/maxLength|minLength|\u2014/);
  });
});
