import type { Target } from "./edit";
import type { ResumeComment } from "./revise";
import { relocateTarget, REVIEW_KINDS, REVIEW_PRIORITIES, type ReviewItem } from "./review";
import type { ResumeDoc } from "./schema";

// The last recruiter review, saved with the job's resume (StoredEngineResume.review), so reopening
// the job shows it again without another AI call. What's kept: the model's summary and its items
// after code planned them (planReviewItems), what she queued, ignored or already applied, the
// readiness counts when the review ran (the "before" of the meters), and a fingerprint of the page
// it was made for. The meters' current numbers are never stored: they are recounted by code from
// the page on screen (coverage.ts skillReadiness, decision #7).

/** Counts by code (coverage.ts skillReadiness), never by the model. */
export interface ReadinessCounts {
  total: number;
  shown: number;
  proven: number;
}

export interface QueuedReviewItem {
  id: string;
  comment: ResumeComment;
  /** The spot's text when queued, to find it again on a changed page. */
  quote?: string;
}

export interface StoredReview {
  summary: string | null;
  /** The model's items, as code planned them. Code items are recomputed from the page instead. */
  items: ReviewItem[];
  queued: QueuedReviewItem[];
  ignored: string[];
  /** Applied, or (after a reopen on a changed page) about a spot that no longer exists. */
  done: string[];
  baseline: ReadinessCounts | null;
  /** docFingerprint of the visible page the review was made for. */
  fingerprint: string;
  savedAt: number;
}

/** A short, stable fingerprint of a page (FNV-1a over its JSON). Same page, same string. */
export function docFingerprint(doc: ResumeDoc): string {
  const s = JSON.stringify(doc);
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return `${(h >>> 0).toString(16)}:${s.length}`;
}

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);
const strings = (x: unknown): string[] => (Array.isArray(x) ? x.filter((s): s is string => typeof s === "string") : []);
const SECTIONS = ["education", "experience", "projects", "skills", "leadership"];

function parseTarget(x: unknown): Target | undefined {
  if (!isObj(x) || typeof x.section !== "string" || !SECTIONS.includes(x.section) || typeof x.entry !== "number") return undefined;
  return { section: x.section as Target["section"], entry: x.entry, ...(typeof x.bullet === "number" ? { bullet: x.bullet } : {}) };
}

function parseComment(x: unknown): ResumeComment | null {
  if (!isObj(x) || typeof x.id !== "string" || typeof x.note !== "string") return null;
  const target = parseTarget(x.target);
  return { id: x.id, quote: typeof x.quote === "string" ? x.quote : "", note: x.note, ...(target ? { target } : {}) };
}

const ACTIONS = ["revise", "add_skill", "ask_skill", "place_skill", "ask_fact"];

function parseItem(x: unknown): ReviewItem | null {
  if (!isObj(x) || typeof x.id !== "string" || typeof x.title !== "string" || !isObj(x.action)) return null;
  if (!(REVIEW_KINDS as readonly unknown[]).includes(x.kind) || !(REVIEW_PRIORITIES as readonly unknown[]).includes(x.priority)) return null;
  const a = x.action;
  if (!ACTIONS.includes(a.type as string)) return null;
  if (a.type === "revise" && !parseComment(a.comment)) return null;
  if ((a.type === "add_skill" || a.type === "ask_skill" || a.type === "place_skill") && typeof a.skill !== "string") return null;
  if ((a.type === "ask_skill" || a.type === "place_skill" || a.type === "ask_fact") && typeof a.question !== "string") return null;
  const target = parseTarget(x.target);
  const action =
    a.type === "revise"
      ? { type: "revise" as const, comment: parseComment(a.comment)! }
      : a.type === "ask_fact"
        ? { type: "ask_fact" as const, question: a.question as string, change: typeof a.change === "string" ? a.change : "", ...(parseTarget(a.target) ? { target: parseTarget(a.target) } : {}) }
        : a.type === "add_skill"
          ? { type: "add_skill" as const, skill: a.skill as string }
          : { type: a.type as "ask_skill" | "place_skill", skill: a.skill as string, question: a.question as string };
  return {
    id: x.id,
    kind: x.kind as ReviewItem["kind"],
    priority: x.priority as ReviewItem["priority"],
    title: x.title,
    why: typeof x.why === "string" ? x.why : "",
    detail: typeof x.detail === "string" ? x.detail : "",
    ...(typeof x.where === "string" ? { where: x.where } : {}),
    ...(target ? { target } : {}),
    ...(typeof x.skill === "string" ? { skill: x.skill } : {}),
    ...(typeof x.quote === "string" ? { quote: x.quote } : {}),
    fromCode: x.fromCode === true,
    action,
  };
}

function parseCounts(x: unknown): ReadinessCounts | null {
  if (!isObj(x) || typeof x.total !== "number" || typeof x.shown !== "number" || typeof x.proven !== "number") return null;
  return { total: x.total, shown: x.shown, proven: x.proven };
}

/** Reads a stored review back; anything malformed is dropped (an item, or the whole review). */
export function parseStoredReview(raw: unknown): StoredReview | null {
  if (!isObj(raw) || typeof raw.fingerprint !== "string") return null;
  const items = Array.isArray(raw.items) ? raw.items.map(parseItem).filter((i): i is ReviewItem => i !== null) : [];
  const queued = Array.isArray(raw.queued)
    ? raw.queued.flatMap((q) => {
        if (!isObj(q) || typeof q.id !== "string") return [];
        const comment = parseComment(q.comment);
        return comment ? [{ id: q.id, comment, ...(typeof q.quote === "string" ? { quote: q.quote } : {}) }] : [];
      })
    : [];
  const summary = typeof raw.summary === "string" ? raw.summary : null;
  const ignored = strings(raw.ignored);
  if (summary === null && items.length === 0 && queued.length === 0 && ignored.length === 0) return null;
  return {
    summary,
    items,
    queued,
    ignored,
    done: strings(raw.done),
    baseline: parseCounts(raw.baseline),
    fingerprint: raw.fingerprint,
    savedAt: typeof raw.savedAt === "number" ? raw.savedAt : 0,
  };
}

/** The spot an item is about, and the text it had (for finding it again). */
function spotOf(item: ReviewItem): { target?: Target; quote?: string } {
  if (item.action.type === "ask_fact" && item.action.target) return { target: item.action.target, quote: item.quote };
  if (item.action.type === "revise" && item.action.comment.target) return { target: item.action.comment.target, quote: item.quote };
  return { target: item.target, quote: item.quote };
}

/** The item with its spot moved to where that text is on the page now. */
function moveItem(item: ReviewItem, to: Target): ReviewItem {
  const action =
    item.action.type === "ask_fact" && item.action.target
      ? { ...item.action, target: to }
      : item.action.type === "revise" && item.action.comment.target
        ? { ...item.action, comment: { ...item.action.comment, target: to } }
        : item.action;
  return { ...item, ...(item.target ? { target: to } : {}), action };
}

/**
 * A stored review, ready to show on the page as it is now. The same page: unchanged. A changed page
 * (an update, a hand edit, an earlier version brought back): every item is kept, an item about one
 * spot is pointed at where that text is now, and one whose spot no longer exists is marked done
 * (stale); a queued change for such a spot is dropped. Pure, tested.
 */
export function restoreReview(stored: StoredReview, doc: ResumeDoc): { review: StoredReview; stale: string[] } {
  const fingerprint = docFingerprint(doc);
  if (stored.fingerprint === fingerprint) return { review: stored, stale: [] };
  const done = new Set(stored.done);
  const stale: string[] = [];
  const items = stored.items.map((item) => {
    const { target, quote } = spotOf(item);
    if (!target || done.has(item.id)) return item;
    const now = relocateTarget(doc, target, quote);
    if (!now) {
      stale.push(item.id);
      done.add(item.id);
      return item;
    }
    return moveItem(item, now);
  });
  const queued = stored.queued.filter((q) => {
    if (done.has(q.id)) return false;
    if (!q.comment.target) return true;
    return relocateTarget(doc, q.comment.target, q.quote) !== undefined;
  });
  return { review: { ...stored, items, queued, done: [...done], fingerprint }, stale };
}
