import { covers, sourceBullets } from "../engine/backfill";
import type { Target } from "../engine/edit";
import type { ResumeDoc } from "../engine/schema";
import { metricsIn } from "../engine/relevance";
import { parseMasterExperiences } from "../master/experiences";

// A model rewrite can quietly drop a number ("cut deploy time by 40%" becomes "cut deploy time").
// Numbers are what a recruiter skims for, so this reports any number from a source bullet that the
// page no longer shows. It only looks at source bullets the page still carries in some form (most
// of its words are there): a bullet left off the page on purpose is not "dropped". Pure code.

export interface DroppedMetric {
  /** The number as the source wrote it: "40%", "80+", "$2M". */
  metric: string;
  company: string;
  /** The page bullet that carries the rest of the source bullet. */
  target: Target;
  /** That page bullet, plain. */
  quote: string;
}

/** Share of a source bullet's words a page bullet must have to count as "the same bullet". */
const SAME_BULLET = 0.4;

const plain = (s: string) => s.replace(/\*\*/g, "");
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
/** The digits of a metric ("~35%" -> "35", "$2M" -> "2"), so "over 80" still shows "80+". */
const digits = (m: string) => m.match(/\d[\d.,]*/)?.[0].replace(/[.,]$/, "") ?? m;
const showsNumber = (text: string, metric: string) => {
  const d = digits(metric).replace(/[.,]/g, "[.,]");
  return new RegExp(`(^|[^0-9.,])${d}(?![0-9])`).test(text);
};

/** Numbers from her source bullets that are missing from the role (or project) they belong to. */
export function droppedMetrics(doc: ResumeDoc, master: string): DroppedMetric[] {
  const entries = parseMasterExperiences(master);
  const out: DroppedMetric[] = [];
  const check = (section: "experience" | "projects", list: ResumeDoc["experience"]) =>
    list.forEach((e, entry) => {
      const m = entries.find((x) => norm(x.company) === norm(e.company));
      if (!m) return;
      const bullets = e.bullets.map(plain);
      const roleText = bullets.join("\n");
      for (const src of sourceBullets(m)) {
        const carrier = bullets.findIndex((b) => covers(b, plain(src)) >= SAME_BULLET);
        if (carrier < 0) continue;
        for (const metric of metricsIn(src)) {
          if (showsNumber(roleText, metric)) continue;
          if (out.some((d) => d.company === e.company && d.metric === metric && d.target.bullet === carrier)) continue;
          out.push({ metric, company: e.company, target: { section, entry, bullet: carrier }, quote: bullets[carrier] });
        }
      }
    });
  check("experience", doc.experience);
  check("projects", doc.projects ?? []);
  return out;
}

export const droppedMessage = (d: DroppedMetric) => `Dropped '${d.metric}' from a ${d.company} bullet.`;

/** Numbers a model call dropped: missing now, but still on the page before it. */
export function metricsDroppedBy(before: ResumeDoc, after: ResumeDoc, master: string): DroppedMetric[] {
  const had = new Set(droppedMetrics(before, master).map((d) => `${d.company}|${d.metric}`));
  return droppedMetrics(after, master).filter((d) => !had.has(`${d.company}|${d.metric}`));
}
