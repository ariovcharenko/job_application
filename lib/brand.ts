// The logo: a location pin inside two open radar arcs ("finds the jobs worth it"). Flat, two tones:
// the outer arc is the soft tone, the inner arc and the pin are the strong tone. Default look is
// white (100% and 60%) on the brand gradient tile; "plain" is the same glyph in purple, no tile.
// Everything is computed here from a few numbers, so the nav mark, the favicon files, the Apple
// touch icon and the link preview are always the same drawing:
//
//   - "detailed": a 100-unit grid for 48px and up (Apple icon, 512px, link preview).
//   - "small": a 32-unit grid for 16, 24 and 32px (favicon, nav). The inner arc is dropped (it
//     would blur into the pin at 16px), strokes are heavier, and the arc's and pin head's straight
//     edges sit on whole pixels at 16 and 32px.
//
// The static files in app/ (icon.svg, apple-icon.png) are generated from this by
// `npx vite-node scripts/build-icons.ts`; run it again after changing anything here.

export const LOGO_GRADIENT = ["#2997FF", "#7B61FF", "#C850C0"] as const;

/** Glyph tones: white on the gradient tile, or the app's purple accent with no tile. */
export const LOGO_TONES = {
  tile: { strong: "#fff", soft: "#fff", softOpacity: 0.6 },
  plain: { strong: "#7B3FE4", soft: "#7B3FE4", softOpacity: 0.4 },
} as const;

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

/** The numbers that define the glyph, in tile units. Arcs and pin share one center column. */
export type GlyphSpec = {
  /** Tile size (the grid). */
  size: number;
  /** Soft-tone outer arc (opening lower right). */
  outer: ArcSpec;
  /** Optional strong-tone inner arc (opening upper right; detailed version only). */
  inner?: ArcSpec;
  /** The pin: round head of radius `r` centered `lift` above the center, point at `tip` below it. */
  pin: { r: number; lift: number; tip: number };
};

export type ArcShape = { d: string; w: number; r: number; ends: [Pt, Pt]; gap: number };

export type Glyph = {
  center: Pt;
  outer: ArcShape;
  inner?: ArcShape;
  /** Filled pin outline (a circle with two tangent lines meeting at the point). */
  pin: string;
  pinHead: { cx: number; cy: number; r: number };
  pinTip: Pt;
};

function buildArc(c: Pt, a: ArcSpec): ArcShape {
  // Each round cap reaches w/2 past its end point, so pull the ends back by that much (as an angle).
  const half = a.gap / 2 + ((a.w / 2 / a.r) * 180) / Math.PI;
  const start = at(c, a.r, a.gapAt + half);
  const end = at(c, a.r, a.gapAt - half);
  return { d: `M${pt(start)}A${a.r} ${a.r} 0 1 1 ${pt(end)}`, w: a.w, r: a.r, ends: [start, end], gap: a.gap };
}

export function buildGlyph(spec: GlyphSpec): Glyph {
  const center = { x: spec.size / 2, y: spec.size / 2 };
  const { r, lift, tip } = spec.pin;
  const head = { x: center.x, y: center.y - lift };
  const point = { x: center.x, y: center.y + tip };
  // Tangent points from the point to the head: angle from straight down = acos(r / distance).
  const a = Math.acos(r / (point.y - head.y));
  const left = { x: head.x - r * Math.sin(a), y: head.y + r * Math.cos(a) };
  const right = { x: head.x + r * Math.sin(a), y: head.y + r * Math.cos(a) };
  return {
    center,
    outer: buildArc(center, spec.outer),
    inner: spec.inner ? buildArc(center, spec.inner) : undefined,
    pin: `M${pt(left)}A${r} ${r} 0 1 1 ${pt(right)}L${pt(point)}Z`,
    pinHead: { cx: head.x, cy: head.y, r },
    pinTip: point,
  };
}

// Detailed: the outer arc opens to the lower right, the inner one to the upper right (offset
// openings read as a radar sweep, not a power button), and the pin floats in the middle with even
// space around it. Glyph spans 65% of the tile.
export const DETAILED_SPEC: GlyphSpec = {
  size: 100,
  outer: { r: 29, w: 7, gapAt: 45, gap: 80 },
  inner: { r: 18, w: 7, gapAt: -45, gap: 70 },
  pin: { r: 7, lift: 3, tip: 10 },
};
// Small: outer arc edges at 8..12 units from center and the pin head at 12..20 across, so they land
// on whole pixels at 16px (0.5 px per unit) and 32px.
export const SMALL_SPEC: GlyphSpec = {
  size: 32,
  outer: { r: 10, w: 4, gapAt: 45, gap: 76 },
  pin: { r: 4, lift: 2, tip: 6 },
};

export const DETAILED = buildGlyph(DETAILED_SPEC);
export const SMALL = buildGlyph(SMALL_SPEC);
export const DETAILED_TILE = squirclePath(100);
export const SMALL_TILE = squirclePath(32);

/**
 * The full logo as SVG markup. `look` picks white on the gradient tile (default) or the plain
 * purple glyph. `id` keeps gradient ids unique when several logos are on one page. `standalone`
 * adds the xmlns and pixel size for files. `fullBleed` fills the whole square (for the Apple touch
 * icon: iOS rounds the corners itself, and a pre-rounded tile would show dark corners).
 */
export function logoSvg(
  variant: "detailed" | "small",
  opts: { id?: string; px?: number; standalone?: boolean; fullBleed?: boolean; look?: "tile" | "plain" } = {},
): string {
  const id = opts.id ?? "logo";
  const look = opts.look ?? "tile";
  const g = variant === "small" ? SMALL : DETAILED;
  const size = variant === "small" ? 32 : 100;
  const head = opts.standalone
    ? `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}"${opts.px ? ` width="${opts.px}" height="${opts.px}"` : ""}>`
    : `<svg viewBox="0 0 ${size} ${size}">`;
  const t = LOGO_TONES[look];
  const arc = (a: ArcShape, color: string, opacity = 1) =>
    `<path d="${a.d}" fill="none" stroke="${color}" stroke-width="${a.w}" stroke-linecap="round"${opacity < 1 ? ` stroke-opacity="${opacity}"` : ""}/>`;
  const glyph =
    arc(g.outer, t.soft, t.softOpacity) +
    (g.inner ? arc(g.inner, t.strong) : "") +
    // Detailed: a thin same-color stroke with a round join softens the pin's point. Small: none,
    // so the head's edges stay on whole pixels.
    `<path d="${g.pin}" fill="${t.strong}"${variant === "detailed" ? ` stroke="${t.strong}" stroke-width="1.5" stroke-linejoin="round"` : ""}/>`;
  if (look === "plain") return `${head}${glyph}</svg>`;
  const tile = opts.fullBleed ? `M0 0H${size}V${size}H0Z` : variant === "small" ? SMALL_TILE : DETAILED_TILE;
  const gradient =
    `<linearGradient id="${id}-bg" x1="0" y1="0" x2="1" y2="1">` +
    `<stop offset="0" stop-color="${LOGO_GRADIENT[0]}"/><stop offset="0.5" stop-color="${LOGO_GRADIENT[1]}"/><stop offset="1" stop-color="${LOGO_GRADIENT[2]}"/>` +
    `</linearGradient>`;
  return `${head}<defs>${gradient}</defs><path d="${tile}" fill="url(#${id}-bg)"/>${glyph}</svg>`;
}

/** The logo as a data: URI (for next/og, which draws images rather than inline SVG markup). */
export function logoDataUri(variant: "detailed" | "small", px?: number): string {
  return `data:image/svg+xml;utf8,${encodeURIComponent(logoSvg(variant, { standalone: true, px }))}`;
}
