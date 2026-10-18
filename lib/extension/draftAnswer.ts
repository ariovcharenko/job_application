import type { AIProvider } from "../ai/provider";
import type { AnswerBankEntry, Profile } from "../types";

// Drafts an answer to a free-text application question for the Chrome extension. The question and
// the page's job text came from the extension; the draft is shown here and goes back to the form
// only after she approves it. Legal and identity questions are never drafted (decision #4: those
// answers come only from stored Profile fields).

const LEGAL_QUESTION =
  /(authoriz|eligib).{0,40}(work|employ)|sponsor|visa|citizen|work permit|immigration|security clearance|veteran|disabilit|gender|\brace\b|ethnic|pronoun|sexual orientation|criminal|convict|background check|date of birth|\bssn\b|social security/i;

/** True for questions the AI must not answer (work authorization, sponsorship, EEO, clearance...). */
export function isLegalQuestion(question: string): boolean {
  return LEGAL_QUESTION.test(question);
}

export const LEGAL_REFUSAL =
  "This looks like a legal or identity question (work authorization, sponsorship, EEO). Job Copilot never drafts these. Answer it yourself on the form, or save your answers in Settings > Profile so the extension can fill them.";

const SYSTEM = `You write answers to free-text job application questions for a job seeker, in their voice.
Use ONLY facts from the background given (their experience, saved answers, profile). Never invent employers, titles, numbers, skills, dates or projects. If the background does not support an answer, say what is missing in one short sentence starting with "Missing:" instead of guessing.
Be concrete and brief: 3 to 6 sentences unless the question asks for more. Plain sentences, first person. No em dashes or en dashes, no buzzwords ("passionate", "leverage", "synergy"), no opening like "I am excited to apply". Never answer questions about work authorization, visa sponsorship, citizenship, clearance, veteran, disability, gender, race or other legal or identity topics.`;

export async function draftApplicationAnswer(
  provider: AIProvider,
  input: { question: string; jobText: string; profile: Profile; masterProfile: string; answerBank: AnswerBankEntry[] },
): Promise<string> {
  if (isLegalQuestion(input.question)) throw new Error(LEGAL_REFUSAL);
  const bank = input.answerBank
    .slice(0, 12)
    .map((a) => `Q: ${a.question}\nA: ${a.answer}`)
    .join("\n\n");
  const prompt = [
    `Question on the application form:\n${input.question}`,
    `The job page (context only):\n"""\n${input.jobText.slice(0, 6000)}\n"""`,
    `Her experience:\n"""\n${input.masterProfile.slice(0, 12000)}\n"""`,
    bank ? `Answers she already wrote:\n${bank}` : "",
    `School: ${input.profile.school || "(not given)"}`,
  ]
    .filter(Boolean)
    .join("\n\n");
  const text = await provider.complete({ tier: "smart", maxTokens: 700, system: SYSTEM, prompt, effort: "low" });
  return text.replace(/[–—]/g, ",").trim();
}
