import type { ResumeDoc } from "./schema";

// What the last update changed, for the yellow marker in the preview: the words that are new in a
// bullet, a whole bullet or entry that is new, and skills that weren't on the page. Computed by
// code from the page before and after the update, never by the model, so it can't miss or invent a
// change. Works on any resume's entries: they are matched by company/project name, not position.

/** [start, end) character ranges in a bullet's plain text (without ** markers). */
export type Range = [number, number];

export type ChangeMark =
  | { section: "experience" | "projects" | "education"; entry: number; bullet: number; ranges: Range[] | "all" }
  /** A whole entry that wasn't on the page before (its header line). */
  | { section: "experience" | "projects" | "education"; entry: number }
  | { section: "skills"; line: number; item: number }
  | { section: "leadership"; entry: number };

const plain = (s: string) => s.replace(/\*\*/g, "");
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const words = (s: string) => new Set(norm(s).split(" ").filter(Boolean));

/** Share of words two bullets have in common (0 to 1). */
function overlap(a: string, b: string): number {
  const x = words(a);
  const y = words(b);
  if (!x.size || !y.size) return 0;
  let both = 0;
  for (const w of x) if (y.has(w)) both++;
  return both / (x.size + y.size - both);
}

/** A bullet this similar to an old one is shown as edited (changed words marked); less, as new. */
export const SAME_BULLET = 0.35;

interface Token {
  text: string;
  start: number;
  key: string;
}

function tokens(s: string): Token[] {
  const out: Token[] = [];
  for (const m of s.matchAll(/[A-Za-z0-9][A-Za-z0-9+#./%'-]*|[^\sA-Za-z0-9]/g)) {
    out.push({ text: m[0], start: m.index ?? 0, key: m[0].toLowerCase().replace(/[.,;:]+$/, "") });
  }
  return out;
}

/**
 * The ranges of `after` (plain text) whose words aren't in `before`, by a longest-common-subsequence
 * over words. Neighboring changed words are joined into one range, including the space between them.
 */
export function changedRanges(before: string, after: string): Range[] {
  const a = tokens(before);
  const b = tokens(after);
  const n = a.length;
  const m = b.length;
  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) lcs[i][j] = a[i].key === b[j].key ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
  const kept = new Array<boolean>(m).fill(false);
  for (let i = 0, j = 0; i < n && j < m; ) {
    if (a[i].key === b[j].key) {
      kept[j] = true;
      i++;
      j++;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) i++;
    else j++;
  }
  const ranges: Range[] = [];
  b.forEach((t, j) => {
    if (kept[j]) return;
    // Lone punctuation changing (a comma, a period) isn't worth a marker.
    if (!/[A-Za-z0-9]/.test(t.text)) return;
    const end = t.start + t.text.length;
    const last = ranges[ranges.length - 1];
    if (last && /^[\s,;:]*$/.test(after.slice(last[1], t.start))) last[1] = end;
    else ranges.push([t.start, end]);
  });
  return ranges;
}

type EntrySection = "experience" | "projects" | "education";
const nameOf = (section: EntrySection, e: { company?: string; school?: string }) => norm((section === "education" ? e.school : e.company) ?? "");

/** Everything `after` shows that `before` didn't. Positions are `after`'s. */
export function diffDocs(before: ResumeDoc, after: ResumeDoc): ChangeMark[] {
  const marks: ChangeMark[] = [];
  for (const section of ["experience", "projects", "education"] as const) {
    const old = (before[section] ?? []) as { company?: string; school?: string; bullets: string[] }[];
    ((after[section] ?? []) as { company?: string; school?: string; bullets: string[] }[]).forEach((e, entry) => {
      const prev = old.find((o) => nameOf(section, o) === nameOf(section, e));
      if (!prev) {
        marks.push({ section, entry });
        e.bullets.forEach((_, bullet) => marks.push({ section, entry, bullet, ranges: "all" }));
        return;
      }
      const oldPlain = prev.bullets.map(plain);
      e.bullets.forEach((b, bullet) => {
        const text = plain(b);
        if (oldPlain.includes(text)) return;
        let best = -1;
        let score = 0;
        oldPlain.forEach((o, k) => {
          const s = overlap(o, text);
          if (s > score) {
            score = s;
            best = k;
          }
        });
        if (best < 0 || score < SAME_BULLET) {
          marks.push({ section, entry, bullet, ranges: "all" });
          return;
        }
        const ranges = changedRanges(oldPlain[best], text);
        if (ranges.length) marks.push({ section, entry, bullet, ranges });
      });
    });
  }
  const oldSkills = new Set(before.skills.flatMap((l) => l.items.map(norm)));
  after.skills.forEach((l, line) =>
    l.items.forEach((item, i) => {
      if (!oldSkills.has(norm(item))) marks.push({ section: "skills", line, item: i });
    }),
  );
  const oldLead = new Set(before.leadership.map((l) => norm(l.role)));
  after.leadership.forEach((l, entry) => {
    if (!oldLead.has(norm(l.role))) marks.push({ section: "leadership", entry });
  });
  return marks;
}
