import { entryRelevance, focusSkillsIn, showsDomain, type JobFocus } from "./focus";
import { itemMatches } from "./polish";
import type { ResumeDoc } from "./schema";
import type { FitResult } from "./trim";

// The "Tailored for this job" summary on the tailoring screen: in plain words, what code and the
// model did differently for this job (which role got the most room, what the skills lines lead
// with, what was left off). Every line is derived from the finished page and the job focus, so it
// can't claim anything the page doesn't show.

/** "a", "a and b", "a, b and c". */
export function listWords(xs: string[]): string {
  if (xs.length <= 1) return xs[0] ?? "";
  return `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`;
}

const MAX_NAMED = 3;

export function explainTailoring(
  focus: JobFocus,
  fit: Pick<FitResult, "doc" | "leftOffEntries">,
  opts: { copied?: number } = {},
): string[] {
  const doc: ResumeDoc = fit.doc;
  const out: string[] = [];

  const domains = focus.domains.map((d) => d.label);
  if (focus.family !== "Other" || domains.length) {
    const kind = focus.family !== "Other" ? `${/^[AEIOU]/.test(focus.family) ? "an" : "a"} ${focus.family} job` : "a job";
    out.push(domains.length ? `Read as ${kind} focused on ${listWords(domains)}.` : `Read as ${kind}.`);
  }

  const all = [...doc.experience, ...(doc.projects ?? [])];
  const top = doc.experience
    .map((e, i) => ({ e, i, score: entryRelevance(focus, e, all) }))
    .sort((a, b) => b.score - a.score || a.i - b.i)[0];
  if (top) {
    const text = top.e.bullets.join("\n");
    const skills = focusSkillsIn(focus, text);
    // No job skill in the role's bullets: say which of the job's domains it shows instead.
    const shows = (skills.length ? skills : focus.domains.filter((d) => showsDomain(text, d.id)).map((d) => `${d.label} work`)).slice(0, MAX_NAMED);
    const n = top.e.bullets.length;
    out.push(
      `Your ${top.e.company} role is the closest match and gets ${n} bullet${n === 1 ? "" : "s"}${shows.length ? `, showing ${listWords(shows)}` : ""}.`,
    );
  }

  const asked = [...focus.must, ...focus.nice];
  const lead: string[] = [];
  for (const line of doc.skills) {
    for (const item of line.items) {
      if (lead.length >= MAX_NAMED) break;
      if (asked.some((s) => itemMatches(s, item)) && !lead.includes(item)) lead.push(item);
    }
  }
  if (lead.length) out.push(`Skills ordered for ${listWords(lead)} first.`);

  if (fit.leftOffEntries.length) {
    const names = fit.leftOffEntries.map((e) => (e.kind === "role" ? `your ${e.title} role` : `the ${e.company} project`));
    out.push(`Left off ${listWords(names)} to fit one page.`);
  }

  const copied = opts.copied ?? 0;
  if (copied > 0) {
    out.push(`${copied} bullet${copied === 1 ? " is" : "s are"} your own line${copied === 1 ? "" : "s"} from Your experience, copied word for word to fill the page.`);
  }
  return out;
}
