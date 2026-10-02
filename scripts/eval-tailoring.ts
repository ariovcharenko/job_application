// Compares our tailoring with a plain single prompt on the fictional demo candidate and five demo
// jobs, and prints the scores (lib/resume/eval/score.ts). Costs real money: it always prints the
// estimate first, and only calls the API when a key is set and --dry-run is not given.
//
//   npx vite-node scripts/eval-tailoring.ts --dry-run          # estimate only, no API call
//   ANTHROPIC_API_KEY=sk-... npx vite-node scripts/eval-tailoring.ts [--model claude-sonnet-5] [--jobs 2]
//
// Optional: ANTHROPIC_WORKSPACE_ID for keys that need the workspace header.

import { createAnthropicProvider } from "../lib/ai/anthropic";
import { formatUsd } from "../lib/resume/batch";
import { estimateEvalCost, evalJobs, formatRow, HEADER_ROW, runBaseline, runOurs, type EvalResult } from "../lib/resume/eval/run";

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const model = flag("--model") ?? "claude-sonnet-5";
const jobs = evalJobs().slice(0, Number(flag("--jobs") ?? 5));
const dryRun = args.includes("--dry-run");
const key = process.env.ANTHROPIC_API_KEY?.trim();

async function main() {
  const est = estimateEvalCost(model, jobs);
  console.log(`Eval: ${jobs.length} job(s), ours vs a plain prompt, on ${model}.`);
  console.log(`Estimated cost: ${formatUsd(est.lowUsd)} to ${formatUsd(est.highUsd)}${est.known ? "" : " (model not in the price table; a high price was assumed)"}.`);
  if (dryRun || !key) {
    console.log(dryRun ? "Dry run: no API calls made." : "No ANTHROPIC_API_KEY set: no API calls made.");
    return;
  }

  const provider = createAnthropicProvider({ apiKey: key, smartModel: model, fastModel: "claude-haiku-4-5", workspaceId: process.env.ANTHROPIC_WORKSPACE_ID });
  const totals = { ours: 0, base: 0 };
  console.log(HEADER_ROW);
  for (const job of jobs) {
    const run = async (label: string, f: () => Promise<EvalResult>) => {
      try {
        const r = await f();
        console.log(formatRow(`${job.company} ${label}`, r.score));
        if (r.score.droppedSkills.length) console.log(`${"".padEnd(28)} dropped: ${r.score.droppedSkills.join(", ")}`);
        return r.score.total;
      } catch (e) {
        console.log(`${job.company} ${label}: failed (${e instanceof Error ? e.message : String(e)})`);
        return 0;
      }
    };
    totals.ours += await run("ours", () => runOurs(provider, job));
    totals.base += await run("plain", () => runBaseline(provider, job));
  }
  console.log(`Mean score: ours ${Math.round(totals.ours / jobs.length)}, plain prompt ${Math.round(totals.base / jobs.length)}.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
