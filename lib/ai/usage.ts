import { db } from "../db";
import type { AIUsageEntry } from "../types";
import { costOf } from "./prices";
import type { UsageReport } from "./provider";

// The local spend meter: every AI response's tokens are written to the aiUsage table (this
// browser only, never sent anywhere) and priced with lib/ai/prices.ts. Prices are list prices,
// so totals are estimates; a model without a known price uses the high fallback and is marked.

/** Plain names for the tasks in lib/ai/route.ts, for the breakdown. */
export const TASK_LABELS: Record<string, string> = {
  check_job: "Checking jobs",
  read_link: "Reading links",
  import_resume: "Importing your resume",
  draft_outreach: "Outreach drafts",
  draft_answer: "Application answers",
  write_resume: "Writing resumes",
  revise_resume: "Revising resumes",
  polish_resume: "Polishing resumes",
  review_resume: "Resume reviews",
  other: "Other",
};

/** Saves one response's usage. Never throws: a failed write must not fail the AI call. */
export async function recordUsage(task: string, u: UsageReport, at = Date.now()): Promise<void> {
  try {
    await db.aiUsage.add({ at, task, ...u });
  } catch {
    // Storage blocked or full: the meter just misses this one.
  }
}

/** Midnight on the 1st of this month, local time. */
export function monthStart(now = new Date()): number {
  return new Date(now.getFullYear(), now.getMonth(), 1).getTime();
}

export interface SpendLine {
  task: string;
  label: string;
  usd: number;
  calls: number;
}

export interface SpendSummary {
  usd: number;
  calls: number;
  /** True when any entry used a model without a known price (the high fallback). */
  estimated: boolean;
  /** Per task, most expensive first. */
  byTask: SpendLine[];
}

export function summarize(entries: AIUsageEntry[]): SpendSummary {
  const by = new Map<string, SpendLine>();
  let usd = 0;
  let estimated = false;
  for (const e of entries) {
    const c = costOf(e);
    usd += c.usd;
    if (!c.known) estimated = true;
    const line = by.get(e.task) ?? { task: e.task, label: TASK_LABELS[e.task] ?? e.task, usd: 0, calls: 0 };
    line.usd += c.usd;
    line.calls++;
    by.set(e.task, line);
  }
  return { usd, calls: entries.length, estimated, byTask: [...by.values()].sort((a, b) => b.usd - a.usd) };
}

/** Everything since `from` (ms), optionally only some tasks. */
export async function spendSince(from: number, tasks?: readonly string[]): Promise<SpendSummary> {
  const rows = await db.aiUsage.where("at").aboveOrEqual(from).toArray();
  return summarize(tasks ? rows.filter((r) => tasks.includes(r.task)) : rows);
}

/** "$0.84" for a month total. */
export function formatUsd(usd: number): string {
  if (usd > 0 && usd < 0.005) return "under $0.01";
  return `$${usd.toFixed(2)}`;
}

/** "about 4¢" for one run; "under 1¢" for tiny ones. */
export function formatRunCost(usd: number): string {
  const cents = usd * 100;
  if (cents < 1) return "under 1¢";
  if (cents < 100) return `about ${Math.round(cents)}¢`;
  return `about ${formatUsd(usd)}`;
}
