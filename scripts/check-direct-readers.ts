// Live check of the free link readers (lib/intake/sources.ts) against real public postings. No AI,
// no key, no login: it only reads public job-listing APIs and prints word counts (never the text).
//
//   npx vite-node scripts/check-direct-readers.ts                  # finds one live posting per ATS
//   npx vite-node scripts/check-direct-readers.ts <posting link>   # or check specific links

import { looksLikeJobPosting } from "../lib/intake/analyze";
import { planLink, readDirectPosting } from "../lib/intake/sources";

async function json(url: string): Promise<unknown> {
  const res = await fetch(url);
  return res.json();
}

async function discover(): Promise<string[]> {
  const urls: string[] = [];
  const gh = (await json("https://boards-api.greenhouse.io/v1/boards/stripe/jobs")) as { jobs: { id: number }[] };
  urls.push(`https://boards.greenhouse.io/stripe/jobs/${gh.jobs[0].id}`);
  const lever = (await json("https://api.lever.co/v0/postings/spotify?mode=json")) as { hostedUrl: string }[];
  urls.push(lever[0].hostedUrl);
  const ashby = (await json("https://api.ashbyhq.com/posting-api/job-board/ashby")) as { jobs: { jobUrl: string }[] };
  urls.push(ashby.jobs[0].jobUrl);
  const sr = (await json("https://api.smartrecruiters.com/v1/companies/BoschGroup/postings?limit=1")) as { content: { id: string }[] };
  urls.push(`https://jobs.smartrecruiters.com/BoschGroup/${sr.content[0].id}-posting`);
  return urls;
}

async function main() {
  const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  const urls = args.length ? args : await discover();
  for (const url of urls) {
    const plan = planLink(url);
    const host = new URL(url).hostname;
    if (plan.kind !== "direct") {
      console.log(`${host}: not a direct source (${plan.kind})`);
      continue;
    }
    const t0 = Date.now();
    try {
      const out = await readDirectPosting(plan);
      if (!out) console.log(`${host}: ${plan.source} could not be read directly`);
      else console.log(`${host}: ${plan.source} ok, ${out.text.split(/\s+/).filter(Boolean).length} words, passes shell check: ${looksLikeJobPosting(out.text)}, ${Date.now() - t0} ms`);
    } catch (e) {
      console.log(`${host}: ${plan.source} -> ${e instanceof Error ? e.message : String(e)}`);
    }
  }
}

void main();
