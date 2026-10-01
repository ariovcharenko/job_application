// A pure, font-metric estimate of how a bullet wraps on the page, with no browser. Used by the
// length and "widow" rules in lint.ts. It doesn't need to match Word to the character: it only has
// to tell a one-liner from a two-liner, and a two-liner whose second line is nearly empty.
//
// The estimate:
// - Bullets are 9 pt Times New Roman (lib/resume/engine/layout.ts SIZE.bullet).
// - The text column is the page width minus margins (8.5in - 2 x 0.4in = 7.7in) minus the bullet
//   list's left indent (270 twips = 0.1875in, render.ts), so 7.5125in = 540.9pt = 60.1 em.
// - Each character's advance width comes from Times New Roman's published metrics (in 1/1000 em,
//   the regular weight). Bold Times is a few percent wider, so bold text counts 6% wider.
// - Wrapping is greedy by word, as Word does for left-aligned text.
// With these numbers an average line holds about 125 to 140 characters of typical bullet text
// (fewer with many capitals or bold spans).

/** Advance widths for Times New Roman Regular, 1/1000 em. Unlisted characters count as 500. */
const WIDTH: Record<string, number> = {
  " ": 250, "!": 333, '"': 408, "#": 500, $: 500, "%": 833, "&": 778, "'": 180, "(": 333, ")": 333, "*": 500,
  "+": 564, ",": 250, "-": 333, ".": 250, "/": 278, ":": 278, ";": 278, "<": 564, "=": 564, ">": 564, "?": 444,
  "@": 921, "[": 333, "]": 333, "_": 500, "|": 200, "~": 541, "’": 333, "“": 444, "”": 444,
  a: 444, b: 500, c: 444, d: 500, e: 444, f: 333, g: 500, h: 500, i: 278, j: 278, k: 500, l: 278, m: 778,
  n: 500, o: 500, p: 500, q: 500, r: 333, s: 389, t: 278, u: 500, v: 500, w: 722, x: 500, y: 500, z: 444,
  A: 722, B: 667, C: 667, D: 722, E: 611, F: 556, G: 722, H: 722, I: 333, J: 389, K: 722, L: 611, M: 889,
  N: 722, O: 722, P: 556, Q: 722, R: 667, S: 556, T: 611, U: 722, V: 722, W: 944, X: 722, Y: 722, Z: 611,
};
const BOLD_FACTOR = 1.06;

/**
 * The bullet text column, in 1/1000 em at the bullet's size: (8.5 - 0.8 - 0.1875) in x 72 / 9 pt,
 * times a 0.97 safety factor (the same margin the preview's one-page check uses, fit.ts) so the
 * estimate errs toward wrapping slightly early.
 */
export const LINE_UNITS = ((8.5 - 2 * 0.4 - 270 / 1440) * 72 / 9) * 1000 * 0.97;

export interface Segment {
  text: string;
  bold: boolean;
}

/** "Built **React** app" -> [{Built ,false},{React,true},{ app,false}]. Unpaired ** are dropped. */
export function segments(text: string): Segment[] {
  const pairs = (text.match(/\*\*/g) ?? []).length % 2 === 0;
  if (!pairs) return [{ text: text.replace(/\*\*/g, ""), bold: false }];
  return text
    .split("**")
    .map((t, i) => ({ text: t, bold: i % 2 === 1 }))
    .filter((s) => s.text !== "");
}

const charWidth = (ch: string, bold: boolean) => (WIDTH[ch] ?? 500) * (bold ? BOLD_FACTOR : 1);

interface Word {
  text: string;
  width: number;
}

function wordsOf(text: string): Word[] {
  const words: Word[] = [];
  let cur = "";
  let width = 0;
  for (const seg of segments(text)) {
    for (const ch of seg.text) {
      if (/\s/.test(ch)) {
        if (cur) words.push({ text: cur, width });
        cur = "";
        width = 0;
      } else {
        cur += ch;
        width += charWidth(ch, seg.bold);
      }
    }
  }
  if (cur) words.push({ text: cur, width });
  return words;
}

export interface Wrap {
  /** The words on each estimated line. */
  lines: string[][];
  /** How full the last line is, 0 to 1. */
  lastLineFill: number;
}

/** Greedy word wrap of a bullet (with ** markers) into the bullet column. */
export function wrapBullet(text: string, lineUnits = LINE_UNITS): Wrap {
  const space = WIDTH[" "];
  const lines: string[][] = [];
  let line: string[] = [];
  let used = 0;
  for (const w of wordsOf(text)) {
    const need = line.length ? space + w.width : w.width;
    if (line.length && used + need > lineUnits) {
      lines.push(line);
      line = [w.text];
      used = w.width;
    } else {
      line.push(w.text);
      used += need;
    }
  }
  if (line.length) lines.push(line);
  return { lines, lastLineFill: lines.length ? Math.min(1, used / lineUnits) : 0 };
}
