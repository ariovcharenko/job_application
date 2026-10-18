// The logo: a target with an arrow leaving its bullseye ("apply to the jobs worth it"), white on
// the brand gradient tile. Everything is computed here from a few numbers, so the nav mark, the
// favicon files, the Apple touch icon and the link preview are always the same drawing:
//
//   - "detailed": a 100-unit grid for 48px and up (nav on retina, 180px Apple icon, 512px, OG).
//     Squircle tile, a faint top highlight and bottom shade, a soft shadow under the white glyph.
//   - "small": a 32-unit grid for 16 and 32px favicons. Heavier strokes, no depth effects, the
//     arrowhead's straight legs on whole pixels at both 16 and 32px.
//
// The static files in app/ (icon.svg, apple-icon.png, icon-512.png) are generated from this by
// `npx vite-node scripts/build-icons.ts`; run it again after changing anything here.

export const LOGO_GRADIENT = ["#2997FF", "#7B61FF", "#C850C0"] as const;

type Pt = { x: number; y: number };

const r2 = (n: number) => Math.round(n * 100) / 100;
const pt = (p: Pt) => `${r2(p.x)} ${r2(p.y)}`;

/**
 * Apple-style continuous-corner tile ("squircle"): a superellipse |x|^n + |y|^n = 1, sampled and
 * joined with Catmull-Rom curves so it has no visible facets at any size. n = 4.4 is close to the
 * iOS app icon shape: straight sides that ease into the corners instead of a circle-arc corner.
 */
export function squirclePath(size: number, n = 4.4, samples = 96): string {
  const h = size / 2;
  const pts: Pt[] = [];
  for (let i = 0; i < samples; i++) {
    const t = (i / samples) * Math.PI * 2;
    const c = Math.cos(t);
    const s = Math.sin(t);
    pts.push({ x: h + h * Math.sign(c) * Math.abs(c) ** (2 / n), y: h + h * Math.sign(s) * Math.abs(s) ** (2 / n) });
  }
  let d = `M${pt(pts[0])}`;
  for (let i = 0; i < samples; i++) {
    const p0 = pts[(i - 1 + samples) % samples];
    const p1 = pts[i];
    const p2 = pts[(i + 1) % samples];
    const p3 = pts[(i + 2) % samples];
    const c1 = { x: p1.x + (p2.x - p0.x) / 6, y: p1.y + (p2.y - p0.y) / 6 };
    const c2 = { x: p2.x - (p3.x - p1.x) / 6, y: p2.y - (p3.y - p1.y) / 6 };
    d += `C${pt(c1)} ${pt(c2)} ${pt(p2)}`;
  }
  return `${d}Z`;
}

/** The numbers that define the glyph, in tile units. */
export type GlyphSpec = {
  /** Tile size (the grid). */
  size: number;
  /** Stroke width shared by the ring, the shaft and the arrowhead. */
  stroke: number;
  /** Outer ring radius, to the middle of its stroke. */
  ring: number;
  /** Optional inner ring radius (detailed version only). */
  inner?: number;
  /** Bullseye radius. */
  dot: number;
  /** Distance from the bullseye's center to the arrow's tip. */
  reach: number;
  /** Length of each arrowhead leg. */
  head: number;
  /** Space kept between the ring's cut ends and the arrow, edge to edge. */
  clearance: number;
  /** Nudge from the geometric center, for optical balance (the heavy ring pulls down-left). */
  nudge?: Pt;
  /** Round the arrow tip so the head's legs land on whole pixels at this many pixels per unit. */
  snapTip?: number;
};

export type Glyph = {
  center: Pt;
  tip: Pt;
  /** Ring with a cut where the arrow leaves it. */
  ring: string;
  /** Shaft from the bullseye to the tip, plus the two arrowhead legs. */
  arrow: string;
  dot: { cx: number; cy: number; r: number };
  stroke: number;
  /** Ring ends, at the middle of the stroke (for tests). */
  ringEnds: Pt[];
};

/** Arrow direction: up and to the right, 45 degrees (screen coordinates, y down). */
const AXIS = -Math.PI / 4;
const at = (c: Pt, radius: number, angle: number): Pt => ({ x: c.x + radius * Math.cos(angle), y: c.y + radius * Math.sin(angle) });

/** Distance from point p to the segment ab. */
export function distToSegment(p: Pt, a: Pt, b: Pt): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

export function buildGlyph(spec: GlyphSpec): Glyph {
  const { size, stroke, ring, dot, reach, head, clearance } = spec;
  const k = Math.SQRT1_2;
  // Center the glyph's outer bounds in the tile: ring on the left and bottom, arrow tip on the top
  // and right. Both directions extend by the same amounts, so one offset centers both axes.
  const offset = (reach * k - ring) / 2;
  let center: Pt = { x: size / 2 - offset + (spec.nudge?.x ?? 0), y: size / 2 + offset + (spec.nudge?.y ?? 0) };
  let tip = at(center, reach, AXIS);
  if (spec.snapTip) {
    // Put the tip where the head's horizontal and vertical legs have whole-pixel edges.
    const q = 1 / spec.snapTip;
    const half = stroke / 2;
    const snapped = { x: Math.round((tip.x + half) / q) * q - half, y: Math.round((tip.y - half) / q) * q + half };
    center = { x: center.x + snapped.x - tip.x, y: center.y + snapped.y - tip.y };
    tip = snapped;
  }
  const legA = { x: tip.x - head, y: tip.y };
  const legB = { x: tip.x, y: tip.y + head };

  // Cut each ring just enough that its round ends keep `clearance` from the shaft and the head.
  const needed = stroke + clearance;
  const cut = (radius: number) => {
    const clear = (angle: number) => {
      const p = at(center, radius, angle);
      return Math.min(distToSegment(p, center, tip), distToSegment(p, legA, tip), distToSegment(p, legB, tip)) >= needed;
    };
    let gap = 0;
    while (gap < Math.PI / 2 && !(clear(AXIS + gap) && clear(AXIS - gap))) gap += Math.PI / 720;
    const start = at(center, radius, AXIS + gap);
    const end = at(center, radius, AXIS - gap);
    return { d: `M${pt(start)}A${r2(radius)} ${r2(radius)} 0 1 1 ${pt(end)}`, ends: [start, end] as [Pt, Pt] };
  };

  const outer = cut(ring);
  const inner = spec.inner ? cut(spec.inner) : null;
  return {
    center,
    tip,
    ring: inner ? `${outer.d}${inner.d}` : outer.d,
    arrow: `M${pt(center)}L${pt(tip)}M${pt(legA)}L${pt(tip)}L${pt(legB)}`,
    dot: { cx: r2(center.x), cy: r2(center.y), r: dot },
    stroke,
    ringEnds: inner ? [...outer.ends, ...inner.ends] : outer.ends,
  };
}

// Detailed: two rings and a bullseye, so it reads as a target (a single ring plus an up-right arrow
// is the "male" sign). One stroke weight for both rings, the shaft and the head; the gaps between
// rings and bullseye are equal.
export const DETAILED_SPEC: GlyphSpec = {
  size: 100,
  stroke: 6,
  ring: 25,
  inner: 14,
  dot: 6,
  reach: 43,
  head: 15,
  clearance: 4.5,
  nudge: { x: 0.3, y: -0.3 },
};
// Small: the inner ring is dropped (it would blur into the bullseye at 16px) and strokes are heavier.
export const SMALL_SPEC: GlyphSpec = { size: 32, stroke: 4, ring: 9, dot: 3, reach: 16, head: 6, clearance: 2, snapTip: 0.5 };

export const DETAILED = buildGlyph(DETAILED_SPEC);
export const SMALL = buildGlyph(SMALL_SPEC);
export const DETAILED_TILE = squirclePath(100);
export const SMALL_TILE = squirclePath(32);

/**
 * The full logo as SVG markup. `id` keeps gradient and filter ids unique when several logos are on
 * one page. `standalone` adds the xmlns and pixel size for files. `fullBleed` fills the whole
 * square (for the Apple touch icon: iOS rounds the corners itself, and a pre-rounded tile would
 * show dark corners).
 */
export function logoSvg(
  variant: "detailed" | "small",
  opts: { id?: string; px?: number; standalone?: boolean; fullBleed?: boolean } = {},
): string {
  const id = opts.id ?? "logo";
  const small = variant === "small";
  const g = small ? SMALL : DETAILED;
  const size = small ? 32 : 100;
  const tile = opts.fullBleed ? `M0 0H${size}V${size}H0Z` : small ? SMALL_TILE : DETAILED_TILE;
  const head = opts.standalone
    ? `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}"${opts.px ? ` width="${opts.px}" height="${opts.px}"` : ""}>`
    : `<svg viewBox="0 0 ${size} ${size}">`;
  const gradient =
    `<linearGradient id="${id}-bg" x1="0" y1="0" x2="1" y2="1">` +
    `<stop offset="0" stop-color="${LOGO_GRADIENT[0]}"/><stop offset="0.5" stop-color="${LOGO_GRADIENT[1]}"/><stop offset="1" stop-color="${LOGO_GRADIENT[2]}"/>` +
    `</linearGradient>`;
  const glyph =
    `<path d="${g.ring}" fill="none" stroke="#fff" stroke-width="${g.stroke}" stroke-linecap="round"/>` +
    `<path d="${g.arrow}" fill="none" stroke="#fff" stroke-width="${g.stroke}" stroke-linecap="round" stroke-linejoin="round"/>` +
    `<circle cx="${g.dot.cx}" cy="${g.dot.cy}" r="${g.dot.r}" fill="#fff"/>`;
  if (small) {
    return `${head}<defs>${gradient}</defs><path d="${tile}" fill="url(#${id}-bg)"/>${glyph}</svg>`;
  }
  // Depth, kept quiet: light from above (a soft white wash on the top half and a hairline highlight
  // on the top edge), a faint shade toward the bottom, and a soft shadow under the glyph.
  const defs =
    gradient +
    `<linearGradient id="${id}-light" x1="0" y1="0" x2="0" y2="1">` +
    `<stop offset="0" stop-color="#fff" stop-opacity="0.12"/><stop offset="0.5" stop-color="#fff" stop-opacity="0"/>` +
    `<stop offset="0.75" stop-color="#1B0B4A" stop-opacity="0"/><stop offset="1" stop-color="#1B0B4A" stop-opacity="0.1"/>` +
    `</linearGradient>` +
    `<linearGradient id="${id}-edge" x1="0" y1="0" x2="0" y2="1">` +
    `<stop offset="0" stop-color="#fff" stop-opacity="0.2"/><stop offset="0.3" stop-color="#fff" stop-opacity="0"/>` +
    `</linearGradient>` +
    `<clipPath id="${id}-clip"><path d="${tile}"/></clipPath>` +
    `<filter id="${id}-shadow" x="-20%" y="-20%" width="140%" height="140%">` +
    `<feDropShadow dx="0" dy="1.6" stdDeviation="1.8" flood-color="#2A0F6B" flood-opacity="0.3"/>` +
    `</filter>`;
  return (
    `${head}<defs>${defs}</defs>` +
    `<path d="${tile}" fill="url(#${id}-bg)"/>` +
    `<path d="${tile}" fill="url(#${id}-light)"/>` +
    (opts.fullBleed ? "" : `<path d="${tile}" fill="none" stroke="url(#${id}-edge)" stroke-width="1.2" clip-path="url(#${id}-clip)"/>`) +
    `<g filter="url(#${id}-shadow)">${glyph}</g>` +
    `</svg>`
  );
}

/** The logo as a data: URI (for next/og, which draws images rather than inline SVG markup). */
export function logoDataUri(variant: "detailed" | "small", px?: number): string {
  return `data:image/svg+xml;utf8,${encodeURIComponent(logoSvg(variant, { standalone: true, px }))}`;
}
