import { callJev, choice, type JevOptions, type JevQuestion } from "../../ai/jev";
import { parseMasterExperiences } from "../master/experiences";
import type { ResumeDoc } from "./schema";
import { findEntry, plain, type WordingHit } from "./validate";

// Wording check: catches same-facts inflation ("helped with the login page" -> "led the
// authentication redesign") that validate.ts cannot, because no new number, skill or employer is
// involved. Optional and advisory: it runs only with a saved Jev key, its notes never remove or
// block a bullet, and on no key or any Jev error it returns nothing, so the app behaves exactly as
// without it. The pattern is Jev's citation check (docs.typesafe.ai/cookbooks/citation_check.md):
// one Choice question per claim, asked about the claim and its source text.

/**
 * Flag when the top choice is "overstated" or "unsupported" with Choice confidence at least this.
 * Choice confidence is (p_max - 1/n) / (1 - 1/n) (docs /confidence.md); with 3 options 0.7 means
 * p_max >= 0.8, the same bar the citation check cookbook uses to accept a verdict on its own
 * (AUTO_ACCEPT = 0.8). A note here is advisory and keeps the bullet, so it is not set higher.
 */
export const WORDING_MIN_CONFIDENCE = 0.7;
/** Jev's pass-through takes at most 20 questions per request. */
export const QUESTIONS_PER_REQUEST = 20;
/** At most this many bullets are checked per run (two requests), most-changed first. */
export const MAX_BULLETS_CHECKED = 40;
/** A bullet at least this similar to one of its source lines (word overlap) is not sent. */
export const SKIP_SIMILARITY = 0.85;
const MAX_SOURCE_CHARS = 1200;
const MAX_SHORT_SOURCE = 140;

/** Safe answer first: Choice leans to its first option, so doubt falls back to "supported". */
export const WORDING_OPTIONS: Record<string, string> = {
  supported: "Every claim in the bullet is stated or clearly implied by the source",
  overstated: "The bullet claims a bigger role, scope, ownership or result than the source",
  unsupported: "The bullet states something the source does not mention",
};

const STATE = "A resume bullet and the source lines from the candidate's own experience.";

const words = (s: string) =>
  new Set(
    plain(s)
      .toLowerCase()
      .split(/[^a-z0-9+#.]+/)
      .map((w) => w.replace(/^\.+|\.+$/g, ""))
      .filter((w) => w.length > 1),
  );

function similarity(a: string, b: string): number {
  const x = words(a);
  const y = words(b);
  if (!x.size || !y.size) return 0;
  let both = 0;
  for (const w of x) if (y.has(w)) both++;
  return both / (x.size + y.size - both);
}

/** The lines under a master entry's heading, without list markers or bold. */
function sourceLinesOf(block: string): string[] {
  return block
    .split(/\r?\n/)
    .slice(1)
    .map((l) => plain(l).replace(/^[\s>*\-•]+/, "").trim())
    .filter(Boolean);
}

export interface WordingCandidate {
  text: string;
  /** All the entry's source lines, closest first. */
  lines: string[];
  /** 0 = same as a source line, 1 = nothing in common. */
  change: number;
}

/**
 * The bullets worth asking about: each is matched to the master entry of its own role or project,
 * and skipped when it is (nearly) a source line or its entry has no source text. Most changed first.
 */
export function wordingCandidates(doc: ResumeDoc, master: string): WordingCandidate[] {
  const entries = parseMasterExperiences(master);
  if (!entries.length) return [];
  const out: WordingCandidate[] = [];
  const seen = new Set<string>();
  for (const section of ["experience", "projects"] as const) {
    for (const e of doc[section] ?? []) {
      const entry = findEntry(entries, e);
      if (!entry) continue;
      const lines = sourceLinesOf(entry.block);
      if (!lines.length) continue;
      for (const b of e.bullets) {
        const text = plain(b);
        if (!text.trim() || seen.has(text)) continue;
        seen.add(text);
        const ranked = lines.map((l) => ({ l, s: similarity(text, l) })).sort((p, q) => q.s - p.s);
        if (ranked[0].s >= SKIP_SIMILARITY) continue;
        out.push({ text, lines: ranked.map((r) => r.l), change: 1 - ranked[0].s });
      }
    }
  }
  return out.sort((a, b) => b.change - a.change).slice(0, MAX_BULLETS_CHECKED);
}

function sourceText(lines: string[]): string {
  const out: string[] = [];
  let used = 0;
  for (const l of lines) {
    if (used + l.length > MAX_SOURCE_CHARS && out.length) break;
    out.push(l.slice(0, MAX_SOURCE_CHARS));
    used += l.length;
  }
  return out.join("\n");
}

/** One Choice question for a bullet. The text sits in the instructions because a request has one shared state. */
export function wordingQuestion(c: WordingCandidate): JevQuestion {
  return choice(`Source:\n${sourceText(c.lines)}\nBullet: ${c.text}\nHow does the bullet compare with the source?`, WORDING_OPTIONS);
}

const shorten = (s: string) => (s.length <= MAX_SHORT_SOURCE ? s : `${s.slice(0, MAX_SHORT_SOURCE - 3).trimEnd()}...`);

/**
 * Checks the finished document. Returns the bullets Jev flagged. Never throws: no key, nothing to
 * check, a cancel or any Jev error gives []. Chunks of QUESTIONS_PER_REQUEST go one after another
 * (callJev spaces requests 2 seconds apart); a failure in any chunk drops the whole result.
 */
export async function checkWording(jevKey: string | undefined, doc: ResumeDoc, master: string, opts: JevOptions = {}): Promise<WordingHit[]> {
  if (!jevKey?.trim()) return [];
  try {
    const candidates = wordingCandidates(doc, master);
    const hits: WordingHit[] = [];
    for (let i = 0; i < candidates.length; i += QUESTIONS_PER_REQUEST) {
      if (opts.signal?.aborted) return [];
      const chunk = candidates.slice(i, i + QUESTIONS_PER_REQUEST);
      const questions: Record<string, JevQuestion> = {};
      chunk.forEach((c, k) => (questions[`b${k}`] = wordingQuestion(c)));
      const r = await callJev(jevKey, STATE, questions, opts);
      chunk.forEach((c, k) => {
        const a = r.answers[`b${k}`];
        if (a?.type !== "choice") return;
        if ((a.choice === "overstated" || a.choice === "unsupported") && a.confidence >= WORDING_MIN_CONFIDENCE) hits.push({ text: c.text, source: shorten(c.lines[0]) });
      });
    }
    return hits;
  } catch {
    return [];
  }
}
