import { describe, expect, it } from "vitest";
import { findSavedAnswer, normalizeQuestion, topicOf } from "./answerMatch";
import type { SyncedAnswer } from "../types";

const bank: SyncedAnswer[] = [
  { question: "Why do you want to work at Brightloop?", answer: "Because of the queue work.", tags: [] },
  { question: "Tell us about a project you are proud of", answer: "I built DemoDeck.", tags: [] },
  { question: "What is your greatest weakness?", answer: "I over-polish.", tags: [] },
  { question: "How did you hear about us?", answer: "A friend.", tags: [] },
];

describe("findSavedAnswer", () => {
  it("matches the same question ignoring case and punctuation", () => {
    expect(findSavedAnswer("why do you want to work at brightloop", bank)).toMatchObject({ by: "same", answer: { answer: "Because of the queue work." } });
  });
  it("matches the same topic worded differently, for another company", () => {
    expect(findSavedAnswer("What interests you about Taskwise?", bank)).toMatchObject({ by: "topic", answer: { question: "Why do you want to work at Brightloop?" } });
    expect(findSavedAnswer("Why are you applying to this role?", bank)?.answer.question).toMatch(/Brightloop/);
    expect(findSavedAnswer("Describe a technical project you are most proud of.", bank)?.answer.answer).toBe("I built DemoDeck.");
    expect(findSavedAnswer("Where did you hear about this job?", bank)?.answer.answer).toBe("A friend.");
  });
  it("matches by shared words when no topic applies", () => {
    const b: SyncedAnswer[] = [{ question: "Preferred programming languages", answer: "TypeScript", tags: [] }];
    expect(findSavedAnswer("What programming languages do you prefer?", b)?.by).toBe("words");
  });
  it("returns null for unrelated or empty questions", () => {
    expect(findSavedAnswer("What is your favorite color?", bank)).toBeNull();
    expect(findSavedAnswer("", bank)).toBeNull();
    expect(findSavedAnswer("Why us?", [])).toBeNull();
  });
  it("normalizes and finds topics", () => {
    expect(normalizeQuestion("  Why, us?! ")).toBe("why us");
    expect(topicOf("Describe your greatest strength")).toBe("strength");
    expect(topicOf("Favorite color")).toBeNull();
  });
});
