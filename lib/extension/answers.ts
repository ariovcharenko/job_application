import { db } from "../db";
import { isLegalQuestion, LEGAL_REFUSAL } from "./draftAnswer";

/** A question in comparable form: lowercase words only. */
export const normalizeQuestion = (q: string) => q.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/**
 * Adds an answer she wrote on an application form to her answer bank ("Save to answer bank" in the
 * extension). The same question (ignoring case and punctuation) is never added twice and never
 * overwrites what she already saved; edit it under Settings > Answer bank instead. Legal and
 * identity questions are refused: those answers come only from the Profile (decision #4).
 */
export async function saveAnswerFromExtension(question: string, answer: string): Promise<{ saved: boolean; duplicate: boolean }> {
  if (isLegalQuestion(question)) throw new Error(LEGAL_REFUSAL);
  const key = normalizeQuestion(question);
  const existing = await db.answerBank.toArray();
  if (existing.some((a) => normalizeQuestion(a.question) === key)) return { saved: false, duplicate: true };
  await db.answerBank.add({ question: question.trim(), answer: answer.trim(), tags: ["from extension"] });
  return { saved: true, duplicate: false };
}
