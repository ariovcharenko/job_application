// How much a bullet is worth keeping when the page is full, scored by code (decision #7: numbers
// come from code, never from the model). Three signals, all cheap and explainable:
//  - the job's skills the bullet shows (a scorer passed in, see lib/resume/coverage.ts skillHits),
//  - whether it carries a real metric (a quantity with its unit, not a name like S3 or k6),
//  - the model's own order (bullets arrive most relevant first within each role).

const plain = (s: string) => s.replace(/\*\*/g, "");

/** Units and markers that make a bare number a measurement: "40%", "50+", "3x", "300 ms", "10k". */
const UNIT = /^\s?(?:%|\+|x\b|×|k\b|K\b|M\b|B\b|ms\b|s\b|sec\b|secs\b|seconds?\b|minutes?\b|mins?\b|hours?\b|hrs?\b|days?\b|weeks?\b|months?\b)/;
const YEAR = /^(?:19|20)\d{2}$/;

/**
 * The real metrics in a bullet: numbers that measure something ("6 production features",
 * "80+ early users", "~35%", "p95 ~250-450 ms", ">99% uptime", "$2M"). Not numbers that are part of
 * a name or a version: S3, k6, p95, EC2, HTTP/2, Java 17, React 18, Next.js 14, Python 3.11, or a
 * year. A plain number counts only when it starts the sentence's object ("Built 6 ...", "for 3
 * teams"), i.e. the word before it is the opening verb or a lowercase word.
 */
export function metricsIn(text: string): string[] {
  const s = plain(text);
  const out: string[] = [];
  const re = /(^|[^A-Za-z0-9_./\-])([$~<>≈]?)(\d+(?:[.,]\d+)?)/g;
  for (let m = re.exec(s); m; m = re.exec(s)) {
    const start = m.index + m[1].length;
    const [prefix, num] = [m[2], m[3]];
    const after = s.slice(m.index + m[0].length);
    // A letter glued on after the digits ("3D", "2FA", "5G") is a name, unless it's a unit.
    if (/^[A-Za-z]/.test(after) && !UNIT.test(after)) continue;
    const unit = after.match(UNIT)?.[0] ?? "";
    if (prefix || unit) {
      out.push(`${prefix}${num}${unit.trimEnd()}`);
      continue;
    }
    if (YEAR.test(num)) continue;
    const before = s.slice(0, start).trimEnd();
    const prevWord = before.match(/(\S+)$/)?.[1] ?? "";
    const isOpeningWord = prevWord !== "" && !/\s/.test(before);
    const versionLike = prevWord !== "" && !isOpeningWord && (/^[A-Z]/.test(prevWord) || /[.#+]/.test(prevWord));
    if (!versionLike) out.push(num);
  }
  return out;
}

export const hasRealMetric = (text: string) => metricsIn(text).length > 0;

/** Scores `text` by how many of the job's skills it shows. Returns 0 when there's no job context. */
export type RelevanceFn = (plainText: string) => number;

const SKILL_WEIGHT = 2;
const MAX_SKILL_HITS = 3;
const METRIC_WEIGHT = 1.5;
const RANK_WEIGHT = 2;

/**
 * A bullet's keep-score: job-skill hits (capped, so one keyword-stuffed bullet can't dominate),
 * plus a real metric, plus its position in the model's most-relevant-first order (1 for the first
 * bullet of the role down to 0 for the last).
 */
export function bulletScore(text: string, position: number, count: number, relevance?: RelevanceFn): number {
  const hits = relevance ? Math.min(MAX_SKILL_HITS, Math.max(0, relevance(plain(text)))) : 0;
  const rank = count > 1 ? 1 - position / (count - 1) : 1;
  return SKILL_WEIGHT * hits + (hasRealMetric(text) ? METRIC_WEIGHT : 0) + RANK_WEIGHT * rank;
}
