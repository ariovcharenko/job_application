// Live check of the JSON-LD extractor (lib/intake/jsonLd.ts) against real public posting pages. No
// AI, no key, no login, and it does NOT go through the API route (so it has none of the route's
// address checks: pass only public career links you chose). Prints title, word count and the
// closed flag; never the page or the description.
//
//   npx vite-node scripts/check-posting-reader.ts <posting link> [<posting link> ...]
//   npx vite-node scripts/check-posting-reader.ts --discover      # one live Workday posting from a public search

import { closedSignal, extractJobPosting, visibleText } from "../lib/intake/jsonLd";

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

async function discoverWorkday(): Promise<string[]> {
  // Workday's public job search for a company site: https://{tenant}.wd5.myworkdayjobs.com/wday/cxs/{tenant}/{site}/jobs
  const base = "https://nvidia.wd5.myworkdayjobs.com";
  const res = await fetch(`${base}/wday/cxs/nvidia/NVIDIAExternalCareerSite/jobs`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "User-Agent": UA },
    body: JSON.stringify({ appliedFacets: {}, limit: 1, offset: 0, searchText: "software engineer" }),
  });
  const data = (await res.json()) as { jobPostings?: { externalPath: string }[] };
  const path = data.jobPostings?.[0]?.externalPath;
  return path ? [`${base}/en-US/NVIDIAExternalCareerSite${path}`] : [];
}

async function check(url: string): Promise<void> {
  const host = new URL(url).host;
  try {
    const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "text/html,application/xhtml+xml" }, redirect: "follow", signal: AbortSignal.timeout(15_000) });
    const html = await res.text();
    const posting = extractJobPosting(html);
    const closed = closedSignal(visibleText(html));
    const words = posting ? posting.descriptionText.split(/\s+/).filter(Boolean).length : 0;
    console.log(`${host}\n  http ${res.status}, page ${Math.round(html.length / 1024)} kB, visible words ${visibleText(html).split(/\s+/).filter(Boolean).length}`);
    console.log(posting ? `  title: ${posting.title}\n  company: ${posting.company}, description words: ${words}, closed flag: ${closed}` : `  no posting found, closed flag: ${closed}`);
  } catch (e) {
    console.log(`${host}\n  failed: ${e instanceof Error ? e.message : String(e)}`);
  }
}

async function main() {
  const args = process.argv.slice(2);
  const urls = args.filter((a) => !a.startsWith("--"));
  if (args.includes("--discover")) urls.push(...(await discoverWorkday()));
  if (!urls.length) {
    console.log("Pass posting links, or --discover.");
    return;
  }
  for (const u of urls) await check(u);
}

void main();
