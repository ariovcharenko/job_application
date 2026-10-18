import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildGlyph, DETAILED, DETAILED_SPEC, distToSegment, logoSvg, SMALL, SMALL_SPEC, squirclePath } from "./brand";

const legs = (g: typeof DETAILED, head: number) => [
  [g.center, g.tip],
  [{ x: g.tip.x - head, y: g.tip.y }, g.tip],
  [{ x: g.tip.x, y: g.tip.y + head }, g.tip],
] as const;

describe("logo geometry", () => {
  for (const [name, g, spec] of [
    ["detailed", DETAILED, DETAILED_SPEC],
    ["small", SMALL, SMALL_SPEC],
  ] as const) {
    it(`${name}: ring cuts keep the clearance from the arrow`, () => {
      for (const end of g.ringEnds) {
        const d = Math.min(...legs(g, spec.head).map(([a, b]) => distToSegment(end, a, b)));
        expect(d).toBeGreaterThanOrEqual(spec.stroke + spec.clearance - 1e-9);
      }
    });

    it(`${name}: glyph stays well inside the tile and close to centered`, () => {
      const half = spec.stroke / 2;
      const left = g.center.x - spec.ring - half;
      const bottom = g.center.y + spec.ring + half;
      const right = g.tip.x + half;
      const top = g.tip.y - half;
      expect(Math.min(left, top, spec.size - right, spec.size - bottom)).toBeGreaterThan(spec.size * 0.1);
      expect(Math.abs(left - (spec.size - right))).toBeLessThan(spec.size * 0.04);
      expect(Math.abs(top - (spec.size - bottom))).toBeLessThan(spec.size * 0.04);
    });
  }

  it("detailed: equal space between bullseye, inner ring and outer ring", () => {
    const s = DETAILED_SPEC;
    const inner = s.inner!;
    const gap1 = inner - s.stroke / 2 - s.dot;
    const gap2 = s.ring - s.stroke / 2 - (inner + s.stroke / 2);
    expect(gap1).toBeCloseTo(gap2, 5);
  });

  it("small: the arrowhead's straight edges land on whole pixels at 16 and 32px", () => {
    const half = SMALL_SPEC.stroke / 2;
    for (const pxPerUnit of [0.5, 1]) {
      for (const edge of [SMALL.tip.x + half, SMALL.tip.y - half, SMALL.tip.y + half]) {
        const px = edge * pxPerUnit;
        expect(Math.abs(px - Math.round(px))).toBeLessThan(1e-6);
      }
    }
  });

  it("builds without the inner ring when none is given", () => {
    expect(buildGlyph({ ...DETAILED_SPEC, inner: undefined }).ringEnds).toHaveLength(2);
    expect(DETAILED.ringEnds).toHaveLength(4);
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

  it("app/icon.svg is the current small drawing (run scripts/build-icons.ts after changes)", () => {
    const file = readFileSync(join(__dirname, "../app/icon.svg"), "utf8").trim();
    expect(file).toBe(logoSvg("small", { standalone: true, px: 32, id: "i" }));
  });
});
