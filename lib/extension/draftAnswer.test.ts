import { describe, expect, it, vi } from "vitest";
import type { AIProvider } from "../ai/provider";
import { DEFAULT_PROFILE } from "../defaults";
import { draftApplicationAnswer, isLegalQuestion } from "./draftAnswer";

const provider = (text: string): AIProvider & { complete: ReturnType<typeof vi.fn> } => ({ id: "t", complete: vi.fn(async () => text), completeJson: vi.fn(), listModels: vi.fn() }) as never;
const input = (question: string) => ({ question, jobText: "Build things.", profile: DEFAULT_PROFILE, masterProfile: "Built a queue.", answerBank: [] });

describe("draftApplicationAnswer", () => {
  it.each([
    "Are you legally authorized to work in the United States?",
    "Will you now or in the future require visa sponsorship?",
    "Veteran status",
    "Do you have an active security clearance?",
    "What is your gender identity?",
  ])("never sends %s to the AI", async (q) => {
    expect(isLegalQuestion(q)).toBe(true);
    const p = provider("x");
    await expect(draftApplicationAnswer(p, input(q))).rejects.toThrow(/legal or identity/);
    expect(p.complete).not.toHaveBeenCalled();
  });

  it("does not mistake ordinary questions for legal ones", () => {
    expect(isLegalQuestion("Why do you want to work at Taskwise?")).toBe(false);
    expect(isLegalQuestion("Describe a project you are proud of.")).toBe(false);
  });

  it("drafts ordinary questions and removes dashes", async () => {
    const p = provider("I built a queue — it was fast.");
    expect(await draftApplicationAnswer(p, input("Tell us about a project."))).toBe("I built a queue , it was fast.");
    expect(p.complete.mock.calls[0][0].system).toContain("ONLY facts");
  });
});
