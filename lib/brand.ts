// The logo: two open radar arcs around a solid center ("finds the jobs worth it"). Flat, solid
// colors only (no gradients), two tones: the outer arc is the soft tone, the inner arc and the dot
// are the strong tone. The outer arc is long and opens to the lower right; the inner one is shorter
// and opens to the upper right, so the two read as deliberate shapes rather than a spinner.
// Everything is computed here from a few numbers, so the nav mark, the favicon files, the Apple
// touch icon and the link preview are always the same drawing:
//
//   - "detailed": a 100-unit grid for 48px and up (Apple icon, 512px, link preview), nudged a
//     little toward the openings so it looks centered (optical centering).
//   - "small": a 32-unit grid for 16, 24 and 32px (favicon, nav). Same parts, heavier, with every
//     straight edge on whole pixels at 16 and 32px.
//
// The static files in app/ (icon.svg, apple-icon.png) are generated from this by
// `npx vite-node scripts/build-icons.ts`; run it again after changing anything here.

/** Solid color treatments. `soft` is a flattened color (no opacity), so it looks the same anywhere. */
export const LOGO_THEMES = {
  /** Default: accent purple tile, white glyph. Reads on light and dark browser tabs alike. */
  purple: { tile: "#7B3FE4", edge: null, strong: "#FFFFFF", soft: "#CAB2F4" },
  /** White tile with a hairline edge, purple glyph. */
  light: { tile: "#FFFFFF", edge: "#E3E3E8", strong: "#7B3FE4", soft: "#CAB2F4" },
  /** Near-black tile, white center, purple outer arc. */
  dark: { tile: "#1D1D1F", edge: null, strong: "#FFFFFF", soft: "#9B6BF0" },
  /** No tile: purple glyph straight on the page. */
  plain: { tile: null, edge: null, strong: "#7B3FE4", soft: "#CAB2F4" },
} as const;
export type LogoTheme = keyof typeof LOGO_THEMES;
export const DEFAULT_THEME: LogoTheme = "purple";

type Pt = { x: number; y: number };

const r2 = (n: number) => Math.round(n * 100) / 100;
const pt = (p: Pt) => `${r2(p.x)} ${r2(p.y)}`;
const rad = (deg: number) => (deg * Math.PI) / 180;
const at = (c: Pt, radius: number, deg: number): Pt => ({ x: c.x + radius * Math.cos(rad(deg)), y: c.y + radius * Math.sin(rad(deg)) });

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

/** An open arc with round caps. Angles in degrees, screen coordinates (0 = right, 90 = down). */
export type ArcSpec = {
  /** Radius to the middle of the stroke. */
  r: number;
  /** Stroke width. */
  w: number;
  /** Direction the opening faces. */
  gapAt: number;
  /** Visible opening, in degrees at radius r, measured between the round caps' outer edges. */
  gap: number;
};

/** The numbers that define the glyph, in tile units. */
export type GlyphSpec = {
  /** Tile size (the grid). */
  size: number;
  /** Soft-tone outer arc. */
  outer: ArcSpec;
  /** Strong-tone inner arc. */
  inner: ArcSpec;
  /** Strong-tone center dot radius. */
  dot: number;
  /**
   * Optical centering: move the glyph this share of the way toward cancelling its ink's off-center
   * pull (both openings are on the right, so the ink leans left). 0 = geometric center.
   */
  optical?: number;
};

export type ArcShape = { d: string; w: number; r: number; ends: [Pt, Pt]; gap: number };

export type Glyph = {
  center: Pt;
  outer: ArcShape;
  inner: ArcShape;
  dot: { cx: number; cy: number; r: number };
};

function buildArc(c: Pt, a: ArcSpec): ArcShape {
  // Each round cap reaches w/2 past its end point, so pull the ends back by that much (as an angle).
  const half = a.gap / 2 + ((a.w / 2 / a.r) * 180) / Math.PI;
  const start = at(c, a.r, a.gapAt + half);
  const end = at(c, a.r, a.gapAt - half);
  return { d: `M${pt(start)}A${a.r} ${a.r} 0 1 1 ${pt(end)}`, w: a.w, r: a.r, ends: [start, end], gap: a.gap };
}

/**
 * Where the glyph's ink balances, relative to the circles' center (round caps ignored). An arc of
 * half-span h radians has its centroid r * sin(h) / h from the center, opposite its opening.
 */
export function inkOffset(spec: Pick<GlyphSpec, "outer" | "inner" | "dot">): Pt {
  let mx = 0;
  let my = 0;
  let total = 0;
  for (const a of [spec.outer, spec.inner]) {
    const h = rad((360 - a.gap) / 2);
    const mass = a.w * a.r * 2 * h;
    const dist = (a.r * Math.sin(h)) / h;
    mx += mass * dist * Math.cos(rad(a.gapAt + 180));
    my += mass * dist * Math.sin(rad(a.gapAt + 180));
    total += mass;
  }
  total += Math.PI * spec.dot * spec.dot;
  return { x: mx / total, y: my / total };
}

export function buildGlyph(spec: GlyphSpec): Glyph {
  const pull = inkOffset(spec);
  const k = spec.optical ?? 0;
  const center = { x: r2(spec.size / 2 - pull.x * k), y: r2(spec.size / 2 - pull.y * k) };
  return {
    center,
    outer: buildArc(center, spec.outer),
    inner: buildArc(center, spec.inner),
    dot: { cx: center.x, cy: center.y, r: spec.dot },
  };
}

// Detailed: dot, inner arc and outer arc separated by equal 5-unit rings of space. The outer arc is
// a long 300-degree sweep, the inner one a shorter 250 degrees, so they don't look like a pair of
// equal chasing arcs. Glyph spans 66% of the tile.
export const DETAILED_SPEC: GlyphSpec = {
  size: 100,
  outer: { r: 29, w: 8, gapAt: 45, gap: 60 },
  inner: { r: 16, w: 8, gapAt: -45, gap: 110 },
  dot: 7,
  optical: 0.5,
};
// Small: dot edges at 2 units, inner arc 4..8, outer arc 10..14 from the center, all even, so every
// straight edge lands on a whole pixel at 16px (0.5 px per unit) and 32px. No optical nudge: half
// a pixel off at 16px would blur everything.
export const SMALL_SPEC: GlyphSpec = {
  size: 32,
  outer: { r: 12, w: 4, gapAt: 45, gap: 64 },
  inner: { r: 6, w: 4, gapAt: -45, gap: 120 },
  dot: 2,
};

export const DETAILED = buildGlyph(DETAILED_SPEC);
export const SMALL = buildGlyph(SMALL_SPEC);

/** SVG markup for any glyph on any theme (the scratch previews use this with other specs). */
export function renderLogo(
  g: Glyph,
  size: number,
  opts: { theme?: LogoTheme; px?: number; standalone?: boolean; fullBleed?: boolean } = {},
): string {
  const t = LOGO_THEMES[opts.theme ?? DEFAULT_THEME];
  const head = opts.standalone
    ? `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}"${opts.px ? ` width="${opts.px}" height="${opts.px}"` : ""}>`
    : `<svg viewBox="0 0 ${size} ${size}">`;
  const arc = (a: ArcShape, color: string) => `<path d="${a.d}" fill="none" stroke="${color}" stroke-width="${a.w}" stroke-linecap="round"/>`;
  let tile = "";
  if (t.tile) {
    const shape = opts.fullBleed ? `M0 0H${size}V${size}H0Z` : squirclePath(size);
    tile = `<path d="${shape}" fill="${t.tile}"/>`;
    // Hairline edge: the same squircle inset by half the line width, so the line sits fully inside
    // the tile and is even all the way around.
    if (t.edge && !opts.fullBleed) {
      const e = size <= 32 ? 1 : 0.8;
      tile += `<path d="${squirclePath(size - e)}" transform="translate(${e / 2} ${e / 2})" fill="none" stroke="${t.edge}" stroke-width="${e}"/>`;
    }
  }
  return (
    head +
    tile +
    arc(g.outer, t.soft) +
    arc(g.inner, t.strong) +
    `<circle cx="${g.dot.cx}" cy="${g.dot.cy}" r="${g.dot.r}" fill="${t.strong}"/>` +
    `</svg>`
  );
}

/**
 * The full logo as SVG markup. `standalone` adds the xmlns and pixel size for files. `fullBleed`
 * fills the whole square (for the Apple touch icon: iOS rounds the corners itself, and a
 * pre-rounded tile would show dark corners).
 */
export function logoSvg(
  variant: "detailed" | "small",
  opts: { px?: number; standalone?: boolean; fullBleed?: boolean; theme?: LogoTheme } = {},
): string {
  return variant === "small" ? renderLogo(SMALL, 32, opts) : renderLogo(DETAILED, 100, opts);
}

/** The logo as a data: URI (for next/og, which draws images rather than inline SVG markup). */
export function logoDataUri(variant: "detailed" | "small", px?: number): string {
  return `data:image/svg+xml;utf8,${encodeURIComponent(logoSvg(variant, { standalone: true, px }))}`;
}
