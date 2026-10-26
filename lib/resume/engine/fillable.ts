import { parseMasterExperiences } from "../master/experiences";
import { ALREADY_SAID, covers } from "./backfill";
import { linesShort } from "./budget";
import type { ResumeDoc } from "./schema";

// Whether a paid "add content to fill the page" update can actually help: only when her experience
// still has bullets, for roles that are on the page, that the page doesn't already say.

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

function sourceBullets(block: string): string[] {
  return block
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => /^[-*•]\s+/.test(l))
    .map((l) => l.replace(/^[-*•]\s+/, "").trim())
    .filter(Boolean);
}

/** How many source bullets of the roles on `doc` the page doesn't already say. */
export function unusedSourceBullets(doc: ResumeDoc, master: string): number {
  const entries = parseMasterExperiences(master);
  const onPage = [...doc.experience, ...(doc.projects ?? [])];
  const everything = onPage.flatMap((e) => e.bullets);
  let count = 0;
  for (const e of onPage) {
    const entry = entries.find((m) => norm(m.company) === norm(e.company));
    if (!entry) continue;
    for (const s of sourceBullets(entry.block)) {
      if (!everything.some((b) => covers(b, s) >= ALREADY_SAID)) count++;
    }
  }
  return count;
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
