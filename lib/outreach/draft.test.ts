import { describe, expect, it, vi } from "vitest";
import type { AIProvider, JsonOptions } from "../ai/provider";
import type { AnswerBankEntry, Profile } from "../types";
import { draftOutreachMessage, LINKEDIN_NOTE_LIMIT } from "./draft";

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
});
