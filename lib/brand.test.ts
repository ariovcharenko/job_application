import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { type ArcShape, buildGlyph, DETAILED, DETAILED_SPEC, type Glyph, type GlyphSpec, logoSvg, SMALL, SMALL_SPEC, squirclePath } from "./brand";

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

    it(`${name}: arc openings stay at least 2px wide at ${minPx}px`, () => {
      for (const a of [g.outer, g.inner].filter(Boolean) as ArcShape[]) {
        expect(opening(a) * pxPerUnit).toBeGreaterThanOrEqual(2);
      }
    });

    it(`${name}: the pin keeps at least 1px of clear space from the arcs at ${minPx}px`, () => {
      const nearest = g.inner ?? g.outer;
      const ringInside = nearest.r - nearest.w / 2;
      const headReach = Math.hypot(g.pinHead.cx - g.center.x, g.pinHead.cy - g.center.y) + g.pinHead.r;
      const tipReach = Math.hypot(g.pinTip.x - g.center.x, g.pinTip.y - g.center.y);
      expect((ringInside - Math.max(headReach, tipReach)) * pxPerUnit).toBeGreaterThanOrEqual(1);
    });

    it(`${name}: rings don't touch each other`, () => {
      if (!g.inner) return;
      expect(g.outer.r - g.outer.w / 2 - (g.inner.r + g.inner.w / 2)).toBeGreaterThan(0);
    });

    it(`${name}: glyph is centered in the tile with a margin`, () => {
      expect(g.center).toEqual({ x: spec.size / 2, y: spec.size / 2 });
      const extent = g.outer.r + g.outer.w / 2;
      expect(spec.size / 2 - extent).toBeGreaterThanOrEqual(spec.size * 0.1);
      // The pin's visual middle (head top to tip) sits on the center within 5% of the tile.
      const top = g.pinHead.cy - g.pinHead.r;
      expect(Math.abs((top + g.pinTip.y) / 2 - g.center.y)).toBeLessThan(spec.size * 0.05);
    });

    it(`${name}: the openings face lower right (outer) and upper right (inner), never straight up`, () => {
      // Straight up with a line into the center would read as a power button.
      expect(spec.outer.gapAt).toBe(45);
      if (spec.inner) expect(spec.inner.gapAt).toBe(-45);
    });
  }

  it("small: the arc's and pin head's straight edges land on whole pixels at 16 and 32px", () => {
    const g = SMALL;
    const edges = [
      g.center.y - g.outer.r - g.outer.w / 2,
      g.center.y - g.outer.r + g.outer.w / 2,
      g.center.x + g.outer.r - g.outer.w / 2,
      g.center.x + g.outer.r + g.outer.w / 2,
      g.pinHead.cx - g.pinHead.r,
      g.pinHead.cx + g.pinHead.r,
      g.pinHead.cy - g.pinHead.r,
    ];
    for (const pxPerUnit of [0.5, 1]) {
      for (const e of edges) expect(Math.abs(e * pxPerUnit - Math.round(e * pxPerUnit))).toBeLessThan(1e-9);
    }
  });

  it("builds without the inner arc when none is given", () => {
    expect(buildGlyph({ ...DETAILED_SPEC, inner: undefined }).inner).toBeUndefined();
    expect(SMALL.inner).toBeUndefined();
    expect(DETAILED.inner).toBeDefined();
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
  it("uses unique ids per instance", () => {
    expect(logoSvg("detailed", { id: "a" })).toContain('id="a-bg"');
    expect(logoSvg("detailed", { id: "a" })).not.toContain('id="logo-bg"');
  });

  it("full bleed fills the square (iOS rounds the Apple icon itself)", () => {
    expect(logoSvg("detailed", { fullBleed: true })).toContain('d="M0 0H100V100H0Z"');
  });

  it("is flat: no filters, shadows or extra gradients", () => {
    for (const v of ["detailed", "small"] as const) {
      const svg = logoSvg(v);
      expect(svg).not.toMatch(/filter|feDropShadow|clipPath/);
      expect(svg.match(/linearGradient id=/g)).toHaveLength(1);
    }
  });

  it("two tones: soft outer arc, strong inner arc and pin", () => {
    const tile = logoSvg("detailed");
    expect(tile).toContain('stroke-opacity="0.6"');
    const plain = logoSvg("detailed", { look: "plain" });
    expect(plain).not.toContain("linearGradient");
    expect(plain).toContain("#7B3FE4");
    expect(plain).toContain('stroke-opacity="0.4"');
  });

  it("app/icon.svg is the current small drawing (run scripts/build-icons.ts after changes)", () => {
    const file = readFileSync(join(__dirname, "../app/icon.svg"), "utf8").trim();
    expect(file).toBe(logoSvg("small", { standalone: true, px: 32, id: "i" }));
  });
});
