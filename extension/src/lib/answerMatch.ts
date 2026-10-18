// Finding her saved answer for a question worded differently on each form ("Why do you want to
// work at X?" / "What interests you about X?"). Two layers: well-known question topics (matched by
// pattern, so "Why Brightloop?" and "Why Taskwise?" are the same topic whatever the company), then
// word overlap after stemming and dropping filler. Pure functions, tested on their own.
//
// A match only ever becomes a one-click suggestion that she reviews; it is never written into the
// form by itself (a saved "why this company" answer may name another company).
import type { SyncedAnswer } from "../types";

const TOPICS: [string, RegExp][] = [
  ["why-company", /\bwhy\b.{0,40}\b(us|company|here|team|organization|work (at|for|with))\b|\b(interest|excit|attract|draw|motivat)\w*\b.{0,40}\b(company|us|here|team|role|position|opportunity)\b|why are you applying|what (interest|excit|attract|draw)\w* you\b/i],
  ["why-role", /\bwhy\b.{0,40}\b(role|position|job|opportunity)\b|what (draws|attracts) you to (this|the) (role|position)/i],
  ["about-you", /tell (us|me) about yourself|introduce yourself|describe yourself|about you\b|brief (bio|introduction)|who are you/i],
  ["proud-project", /\bproud\b|most (significant|impressive) (project|accomplishment|achievement)|describe a project|project you (built|worked on|led)|technical project/i],
  ["strength", /\bstrengths?\b/i],
  ["weakness", /\bweakness(es)?\b|area.{0,10}(to )?improve/i],
  ["challenge", /\b(challenge|challenging|difficult|obstacle|overcame|setback)\b/i],
  ["teamwork", /\b(team ?work|collaborat\w*|work(ed)? (on|in|with) a team|conflict)\b/i],
  ["leadership", /\blead(ership|er)?\b/i],
  ["goals", /five years|5 years|career goals?|long[- ]term goals?|where do you see yourself/i],
  ["hear-about", /how did you (hear|find|learn)|where did you (hear|find)|referred by|source/i],
];

const STOP = new Set(
  "a an the and or of to for in on at with by is are was were be been do does did you your yours we our us this that these those it its as from about please describe tell share briefly what which who whom how when where why would could should can will have has had if any".split(" "),
);

function stem(w: string): string {
  return w.replace(/(ing|ed|es|s|ly)$/i, "").replace(/(.)\1$/, "$1");
}

export function normalizeQuestion(q: string): string {
  return q
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokens(q: string): Set<string> {
  return new Set(
    normalizeQuestion(q)
      .split(" ")
      .filter((w) => w.length > 2 && !STOP.has(w))
      .map(stem),
  );
}

export function topicOf(q: string): string | null {
  return TOPICS.find(([, re]) => re.test(q))?.[0] ?? null;
}

export interface AnswerMatch {
  answer: SyncedAnswer;
  /** "topic": same well-known question; "words": enough shared words. */
  by: "same" | "topic" | "words";
}

const MIN_JACCARD = 0.6;

/** The saved answer that best fits this question, or null when none is close enough. */
export function findSavedAnswer(question: string, bank: SyncedAnswer[]): AnswerMatch | null {
  const q = normalizeQuestion(question);
  if (!q) return null;
  const same = bank.find((a) => normalizeQuestion(a.question) === q);
  if (same) return { answer: same, by: "same" };
  const topic = topicOf(question);
  if (topic) {
    const byTopic = bank.find((a) => topicOf(a.question) === topic);
    if (byTopic) return { answer: byTopic, by: "topic" };
  }
  const qt = tokens(question);
  if (qt.size < 2) return null;
  let best: { a: SyncedAnswer; score: number } | null = null;
  for (const a of bank) {
    const at = tokens(a.question);
    if (at.size < 2) continue;
    let shared = 0;
    for (const t of qt) if (at.has(t)) shared++;
    const score = shared / (qt.size + at.size - shared);
    if (shared >= 2 && score >= MIN_JACCARD && (!best || score > best.score)) best = { a, score };
  }
  return best ? { answer: best.a, by: "words" } : null;
}
