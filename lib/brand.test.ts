import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  type ArcShape,
  buildGlyph,
  DETAILED,
  DETAILED_SPEC,
  type Glyph,
  type GlyphSpec,
  inkOffset,
  LOGO_THEMES,
  type LogoTheme,
  logoSvg,
  SMALL,
  SMALL_SPEC,
  squirclePath,
} from "./brand";

/** Visible opening between an arc's round caps, edge to edge, in tile units. */
const opening = (a: ArcShape) => Math.hypot(a.ends[0].x - a.ends[1].x, a.ends[0].y - a.ends[1].y) - a.w;

const cases: [string, Glyph, GlyphSpec, number][] = [
  // name, glyph, spec, smallest pixel size it's drawn at
  ["detailed", DETAILED, DETAILED_SPEC, 48],
  ["small", SMALL, SMALL_SPEC, 16],
];

describe("logo geometry", () => {
  for (const [name, g, spec, minPx] of cases) {
    const pxPerUnit = minPx / spec.size;

    it(`${name}: both arc openings stay at least 2px wide at ${minPx}px`, () => {
      for (const a of [g.outer, g.inner]) expect(opening(a) * pxPerUnit).toBeGreaterThanOrEqual(2);
    });

    it(`${name}: at least 1px of space between dot, inner arc and outer arc at ${minPx}px`, () => {
      const dotToInner = g.inner.r - g.inner.w / 2 - g.dot.r;
      const innerToOuter = g.outer.r - g.outer.w / 2 - (g.inner.r + g.inner.w / 2);
      expect(Math.min(dotToInner, innerToOuter) * pxPerUnit).toBeGreaterThanOrEqual(1);
    });

    it(`${name}: openings face lower right (outer) and upper right (inner), never up`, () => {
      // Opening at the top would read as a power button.
      expect(spec.outer.gapAt).toBe(45);
      expect(spec.inner.gapAt).toBe(-45);
    });

    it(`${name}: the arcs differ in length, so they don't read as a spinner`, () => {
      expect(Math.abs(spec.outer.gap - spec.inner.gap)).toBeGreaterThanOrEqual(40);
    });

    it(`${name}: glyph stays inside the tile with a margin`, () => {
      const extent = g.outer.r + g.outer.w / 2;
      for (const c of [g.center.x, g.center.y]) {
        expect(Math.min(c - extent, spec.size - c - extent)).toBeGreaterThanOrEqual(spec.size * 0.06);
      }
    });
  }

  it("detailed: optical centering moves the ink's balance point closer to the tile center", () => {
    const pull = inkOffset(DETAILED_SPEC);
    const geometric = Math.hypot(pull.x, pull.y);
    const optical = Math.hypot(DETAILED.center.x + pull.x - 50, DETAILED.center.y + pull.y - 50);
    expect(optical).toBeLessThan(geometric * 0.6);
    // ...but only a nudge: the circles stay within 3% of the geometric center.
    expect(Math.hypot(DETAILED.center.x - 50, DETAILED.center.y - 50)).toBeLessThan(3);
  });

  it("detailed: equal space between dot, inner arc and outer arc", () => {
    const g = DETAILED;
    expect(g.inner.r - g.inner.w / 2 - g.dot.r).toBeCloseTo(g.outer.r - g.outer.w / 2 - (g.inner.r + g.inner.w / 2), 5);
  });

  it("small: centered exactly, every straight edge on whole pixels at 16 and 32px", () => {
    const g = SMALL;
    expect(g.center).toEqual({ x: 16, y: 16 });
    const edges = [g.dot.r, g.inner.r - g.inner.w / 2, g.inner.r + g.inner.w / 2, g.outer.r - g.outer.w / 2, g.outer.r + g.outer.w / 2].flatMap(
      (d) => [16 - d, 16 + d],
    );
    for (const pxPerUnit of [0.5, 1]) {
      for (const e of edges) expect(Math.abs(e * pxPerUnit - Math.round(e * pxPerUnit))).toBeLessThan(1e-9);
    }
  });

  it("buildGlyph with no optical setting uses the geometric center", () => {
    expect(buildGlyph({ ...DETAILED_SPEC, optical: undefined }).center).toEqual({ x: 50, y: 50 });
  });
});

describe("squirclePath", () => {
  it("is a closed path that reaches the tile's edges", () => {
    const d = squirclePath(100);
    expect(d.startsWith("M100 50")).toBe(true);
    expect(d.endsWith("Z")).toBe(true);
    const nums = d.match(/-?\d+(\.\d+)?/g)!.map(Number);
    expect(Math.min(...nums)).toBeGreaterThanOrEqual(-0.5);
    expect(Math.max(...nums)).toBeLessThanOrEqual(100.5);
  });
});

describe("logoSvg", () => {
  const themes = Object.keys(LOGO_THEMES) as LogoTheme[];

  it("is solid color only: no gradients, opacity, filters or patterns, in every theme and size", () => {
    for (const theme of themes) {
      for (const v of ["detailed", "small"] as const) {
        for (const fullBleed of [false, true]) {
          const svg = logoSvg(v, { theme, fullBleed });
          expect(svg).not.toMatch(/gradient|opacity|filter|pattern|url\(/i);
        }
      }
    }
  });

  it("two tones: soft outer arc, strong inner arc and dot", () => {
    for (const theme of themes) {
      const t = LOGO_THEMES[theme];
      const svg = logoSvg("detailed", { theme });
      const strokes = [...svg.matchAll(/stroke="(#[0-9A-F]{6})" stroke-width="\d+(\.\d+)?" stroke-linecap/g)].map((m) => m[1]);
      expect(strokes).toEqual([t.soft, t.strong]);
      expect(svg).toContain(`<circle cx="${DETAILED.dot.cx}" cy="${DETAILED.dot.cy}" r="${DETAILED.dot.r}" fill="${t.strong}"/>`);
      expect(t.soft).not.toBe(t.strong);
    }
  });

  it("defaults to the purple tile; plain has no tile", () => {
    expect(logoSvg("small")).toContain(`fill="${LOGO_THEMES.purple.tile}"`);
    expect(logoSvg("small", { theme: "plain" }).match(/<path/g)).toHaveLength(2);
  });

  it("full bleed fills the square (iOS rounds the Apple icon itself)", () => {
    expect(logoSvg("detailed", { fullBleed: true })).toContain('d="M0 0H100V100H0Z"');
  });

  it("app/icon.svg is the current small drawing (run scripts/build-icons.ts after changes)", () => {
    const file = readFileSync(join(__dirname, "../app/icon.svg"), "utf8").trim();
    expect(file).toBe(logoSvg("small", { standalone: true, px: 32 }));
  });
});
