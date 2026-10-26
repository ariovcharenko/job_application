import { backfillFromExperience } from "./backfill";
import { linesShort } from "./budget";
import type { ResumeDoc } from "./schema";

// Whether a paid "add content to fill the page" update can actually help: only when her experience
// still has bullets, for roles that are on the page, that the page doesn't already say.

/**
 * How many of her own bullets code could still add to `doc`: the same per-role check and caps the
 * pipeline's backfill uses, so the offer never promises lines backfill would refuse.
 */
export function unusedSourceBullets(doc: ResumeDoc, master: string): number {
  return backfillFromExperience(doc, master).added;
}

export interface FillOffer {
  /** Lines the page ends short of full, at the final fill (after the type grew). 0 when full. */
  short: number;
  /** True when a fill update has unused bullets to add. */
  canFill: boolean;
  /** Neutral note for a short page that has nothing left to add; null otherwise. */
  note: string | null;
}

/** What to say about a page that may end short. `fill` is the final fill, `fits` whether it is one page. */
export function fillOffer(doc: ResumeDoc, master: string, fill: number, fits: boolean): FillOffer {
  const short = fits ? linesShort(fill) : 0;
  if (short === 0) return { short: 0, canFill: false, note: null };
  const canFill = unusedSourceBullets(doc, master) > 0;
  return { short, canFill, note: canFill ? null : "Your experience has no more lines to add here." };
}
