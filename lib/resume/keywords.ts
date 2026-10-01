// Free, deterministic keyword-coverage scoring — no AI call. Used to show "coverage went up" on
// the tailoring review screen and to feed the free rule-based prefilter (M4).

const STOPWORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "by", "for", "from", "has", "in", "is", "it", "its",
  "of", "on", "or", "our", "that", "the", "their", "this", "to", "with", "you", "your", "will",
  "we", "us", "who", "have", "into", "using", "use", "such", "than", "then", "can",
]);

/** Lowercased, alphanumeric-only tokens of length > 2, stopwords removed, deduped. */
export function extractKeywords(text: string): string[] {
  const tokens = text
    .toLowerCase()
    .match(/[a-z0-9][a-z0-9+.#-]{1,}/g) ?? [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of tokens) {
    const trimmed = t.replace(/^[-.]+|[-.]+$/g, "");
    if (trimmed.length <= 2 || STOPWORDS.has(trimmed) || seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out;
}

export interface KeywordCoverage {
  /** JD keywords (from mustHave + niceToHave) found anywhere in the resume text. */
  matched: string[];
  missing: string[];
  /** 0-100. */
  score: number;
}

/** How many of the job's key skills/terms show up in the resume text. */
export function scoreKeywordCoverage(resumeText: string, jdKeywords: string[]): KeywordCoverage {
  const resumeWords = new Set(extractKeywords(resumeText));
  const jdSet = [...new Set(jdKeywords.map((k) => k.toLowerCase().trim()).filter(Boolean))];

  const matched: string[] = [];
  const missing: string[] = [];
  for (const kw of jdSet) {
    const kwTokens = extractKeywords(kw);
    const found = kwTokens.length > 0 ? kwTokens.every((t) => resumeWords.has(t)) : resumeText.toLowerCase().includes(kw);
    (found ? matched : missing).push(kw);
  }

  const score = jdSet.length === 0 ? 0 : Math.round((matched.length / jdSet.length) * 100);
  return { matched, missing, score };
}
