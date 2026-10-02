import type { AIProvider } from "../../ai/provider";
import { DEMO_EXPERIENCE, DEMO_JOBS } from "../../demo/data";
import { MODEL_PRICES } from "../batch";
import { estimatePageFill } from "../engine/budget";
import { buildJobFocus } from "../engine/focus";
import { ENGINE_MAX_TOKENS } from "../engine/index";
import { tailorResume } from "../engine/pipeline";
import { buildBrief, buildSystemPrompt, buildUserPrompt } from "../engine/prompt";
import { RESUME_DOC_JSON_SCHEMA, ResumeDocSchema, type ResumeDoc } from "../engine/schema";
import { fitResume } from "../engine/trim";
import { applyApprovals, validateResume } from "../engine/validate";
import { scoreResume, type EvalJob, type ResumeScore } from "./score";

// The offline comparison: our tailoring vs a plain single prompt ("tailor this resume to this job,
// one page"), on the fictional demo candidate (lib/demo/data.ts) and five varied demo jobs. The page
// is measured by the node-side estimate (budget.ts estimatePageFill), the same for both. This
// module never calls an API by itself: the caller passes the provider (scripts/eval-tailoring.ts
// builds a real one only when a key is set; the tests pass a fake).

export const EVAL_COMPANIES = ["Cobalt Payments", "Lumen Health", "Atlas Cloud", "Harbor Analytics", "Pinecrest Robotics"];
export const EVAL_MASTER = DEMO_EXPERIENCE;

export function evalJobs(): EvalJob[] {
  return EVAL_COMPANIES.map((c) => {
    const j = DEMO_JOBS.find((x) => x.signals.company === c)!;
    return { company: c, role: j.signals.role, jd: j.jd, must: j.signals.mustHaveSkills, nice: j.signals.niceToHaveSkills };
  });
}

/** What someone would type into a chat model, plus the JSON shape so the answer can be scored. */
export function baselinePrompt(master: string, job: EvalJob): string {
  return `Here is everything about my experience:
"""
${master.trim()}
"""

Here is the job I'm applying to at ${job.company}:
"""
${job.jd.trim()}
"""

Tailor my resume to this job. One page. Use only what's true from my experience. Mark bold text in bullets with **double asterisks**.`;
}

export interface EvalResult {
  doc: ResumeDoc;
  score: ResumeScore;
  calls: number;
}

/** Ours: the app's pipeline, then the same fit and download rules the tailoring screen uses. */
export async function runOurs(provider: AIProvider, job: EvalJob, master = EVAL_MASTER): Promise<EvalResult> {
  const focus = buildJobFocus({ role: job.role, jdText: job.jd, must: job.must, nice: job.nice });
  const out = await tailorResume({ provider, master, company: job.company, jdText: job.jd, jobSkills: [...job.must, ...job.nice], requiredSkills: job.must, focus, measure: estimatePageFill });
  const fit = fitResume(out.result.doc, estimatePageFill, { focus });
  const doc = applyApprovals(fit.doc, validateResume(fit.doc, master, { jobSkills: [...job.must, ...job.nice] }).flags, new Set());
  return { doc, score: scoreResume(doc, { master, job, fill: estimatePageFill(doc) }), calls: out.calls };
}

/** The baseline: one plain prompt, no rules, no checks, scored as it comes back. */
export async function runBaseline(provider: AIProvider, job: EvalJob, master = EVAL_MASTER): Promise<EvalResult> {
  const doc = await provider.completeJson<ResumeDoc>({
    tier: "smart",
    effort: "high",
    maxTokens: ENGINE_MAX_TOKENS,
    prompt: baselinePrompt(master, job),
    schema: RESUME_DOC_JSON_SCHEMA,
    parse: (raw) => ResumeDocSchema.parse(raw),
  });
  return { doc, score: scoreResume(doc, { master, job, fill: estimatePageFill(doc) }), calls: 1 };
}

const tokens = (chars: number, perToken: number) => Math.ceil(chars / perToken);

/**
 * A low to high dollar estimate for a full run (ours + baseline for every job). Low: one call
 * each, a short answer. High: ours makes its follow-up call too, and every answer thinks at length
 * (effort high) close to the output limit we expect in practice (12k tokens).
 */
export function estimateEvalCost(model: string, jobs = evalJobs(), master = EVAL_MASTER): { lowUsd: number; highUsd: number; known: boolean } {
  const price = MODEL_PRICES[model];
  const [inP, outP] = price ?? [10, 50];
  const usd = (inTok: number, outTok: number) => (inTok * inP + outTok * outP) / 1_000_000;
  let low = 0;
  let high = 0;
  const system = buildSystemPrompt(master).length;
  for (const job of jobs) {
    const focus = buildJobFocus({ role: job.role, jdText: job.jd, must: job.must, nice: job.nice });
    const user = buildUserPrompt(job.company, job.jd, { have: job.must, gaps: [] }, buildBrief(master, focus)).length;
    const base = baselinePrompt(master, job).length;
    low += usd(tokens(system + user, 4), 3000) + usd(tokens(base, 4), 2500);
    high += usd(tokens(system + user, 3), 12000) + usd(tokens(system + user + 6000, 3), 6000) + usd(tokens(base, 3), 12000);
  }
  return { lowUsd: low, highUsd: high, known: !!price };
}

/** One row of the printed comparison. */
export function formatRow(label: string, s: ResumeScore): string {
  const pct = (x: number) => `${Math.round(x * 100)}%`.padStart(5);
  return [
    label.padEnd(28),
    String(s.total).padStart(5),
    pct(s.mustCoverage),
    pct(s.skillsRetained),
    pct(s.fill),
    String(s.blockFlags).padStart(6),
    s.specificity.toFixed(2).padStart(6),
    pct(s.verbVariety),
    String(s.bullets).padStart(7),
  ].join(" ");
}

export const HEADER_ROW = ["".padEnd(28), "score", " must", "kept", " fill", "blocks", " spec", "verbs", "bullets"].join(" ");
