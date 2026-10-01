import { describe, expect, it } from "vitest";
import { popoverPlacement, PREVIEW_SCALE, previewScale } from "./preview";

describe("previewScale", () => {
  it("keeps the desktop size in a wide box", () => {
    expect(previewScale(1000)).toBe(PREVIEW_SCALE);
  });

  it("shrinks the page to fit a phone-width box, so nothing scrolls sideways", () => {
    // A 375px screen: about 290px of box inside a full-screen dialog.
    const s = previewScale(290);
    expect(s).toBeLessThan(PREVIEW_SCALE);
    expect(8.5 * 96 * s + 24).toBeLessThanOrEqual(290);
  });

  it("falls back to the default before the box is measured", () => {
    expect(previewScale(0)).toBe(PREVIEW_SCALE);
  });
});

describe("popoverPlacement", () => {
  const menu = { width: 320, height: 330 };

  it("opens below the line, aligned with it, in a roomy box", () => {
    expect(popoverPlacement({ left: 40, top: 100, bottom: 120 }, { width: 600, height: 800 }, menu)).toEqual({
      x: 40,
      y: 128,
      width: 320,
      maxHeight: 784,
    });
  });

  it("never runs past the right edge, and narrows to a phone-width box", () => {
    const p = popoverPlacement({ left: 250, top: 100, bottom: 120 }, { width: 290, height: 420 }, menu);
    expect(p.width).toBe(274);
    expect(p.x + p.width).toBeLessThanOrEqual(290 - 8);
    expect(p.x).toBeGreaterThanOrEqual(8);
  });

  it("opens above a line near the bottom", () => {
    const p = popoverPlacement({ left: 10, top: 700, bottom: 720 }, { width: 600, height: 800 }, menu);
    expect(p.y).toBe(700 - 330 - 8);
  });

  it("stays inside a short box when it fits neither above nor below", () => {
    const box = { width: 290, height: 420 };
    const p = popoverPlacement({ left: 10, top: 150, bottom: 170 }, box, menu);
    expect(p.y).toBeGreaterThanOrEqual(8);
    expect(p.y + Math.min(menu.height, p.maxHeight)).toBeLessThanOrEqual(box.height - 8);
  });

  it("caps the menu's height at the box's", () => {
    const p = popoverPlacement({ left: 10, top: 20, bottom: 40 }, { width: 290, height: 200 }, menu);
    expect(p.maxHeight).toBe(184);
    expect(p.y + Math.min(menu.height, p.maxHeight)).toBeLessThanOrEqual(200 - 8);
  });
});
