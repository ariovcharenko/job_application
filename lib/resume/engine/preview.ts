// Geometry for the tailoring screen's live preview (TailorPanel): how far to scale the page to fit
// its box, and where the action menu goes so it stays inside that box. Pure, so it's testable.

import { PAGE } from "./layout";

/** The preview's largest scale; on a narrow screen it shrinks to the box's width instead. */
export const PREVIEW_SCALE = 0.72;
/** A US Letter page at 96 CSS px per inch. */
const PAGE_WIDTH_PX = PAGE.widthIn * 96;
/** The preview box's horizontal padding (p-3 on both sides). */
export const BOX_PADDING_PX = 24;

/** The scale that fits a whole page inside a box `boxWidth` px wide, never larger than PREVIEW_SCALE. */
export function previewScale(boxWidth: number): number {
  if (!(boxWidth > 0)) return PREVIEW_SCALE;
  return Math.max(0.2, Math.min(PREVIEW_SCALE, (boxWidth - BOX_PADDING_PX) / PAGE_WIDTH_PX));
}

/**
 * Where the action menu goes inside a box of `box` size for a line at `rect` (both relative to the
 * box): left-aligned with the line but never past either edge, below the line unless that would
 * run off the bottom (then above, then as low as fits), and never taller than the box.
 */
export function popoverPlacement(
  rect: { left: number; top: number; bottom: number },
  box: { width: number; height: number },
  menu: { width: number; height: number },
): { x: number; y: number; width: number; maxHeight: number } {
  const margin = 8;
  const width = Math.max(0, Math.min(menu.width, box.width - margin * 2));
  const maxHeight = Math.max(120, box.height - margin * 2);
  const height = Math.min(menu.height, maxHeight);
  const x = Math.max(margin, Math.min(rect.left, box.width - width - margin));
  const below = rect.bottom + margin;
  const above = rect.top - height - margin;
  const y =
    below + height <= box.height - margin ? below : above >= margin ? above : Math.max(margin, box.height - height - margin);
  return { x, y, width, maxHeight };
}
