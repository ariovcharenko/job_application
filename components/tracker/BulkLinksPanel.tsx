"use client";

import { useRef, useState } from "react";
import { getProvider } from "@/lib/ai";
import { db, getMasterProfile, getPreferences, getProfile, getSettings } from "@/lib/db";
import { analyzeJob, readJobPosting } from "@/lib/intake/analyze";
import {
  estimateBulkCost,
  formatEstimate,
  parseLinks,
  planBulk,
  runBulkCheck,
  type BulkOutcome,
  type BulkPlan,
  type BulkProgress,
} from "@/lib/intake/bulk";
import { saveAnalyzedJob } from "@/lib/intake/save";
import { headlineOf } from "@/lib/intake/stored";
import { todayISO } from "@/lib/tracker/stage";
import type { Application } from "@/lib/types";
import AIErrorNotice from "@/components/resumes/AIErrorNotice";
import { Button, Checkbox, TextArea } from "@/components/ui";

type Phase = "enter" | "confirm" | "running" | "done";

const host = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
};

function jobLine(app: Application) {
  return {
    title: `${app.role || "Job"}${app.company ? ` at ${app.company}` : ""}`,
    detail: headlineOf(app)?.pill ?? "",
  };
}

/**
 * Several job links at once. Nothing is spent until she has seen how many links will be read,
 * roughly what that costs, and which ones she already checked (skipped unless she ticks them).
 * Then one link at a time, cancellable; results land in Checked jobs.
 */
export default function BulkLinksPanel({ onClose, onPaste }: { onClose: () => void; onPaste: (url: string) => void }) {
  const [text, setText] = useState("");
  const [phase, setPhase] = useState<Phase>("enter");
  const [plan, setPlan] = useState<BulkPlan | null>(null);
  const [again, setAgain] = useState<Set<string>>(new Set());
  const [fastModel, setFastModel] = useState("");
  const [progress, setProgress] = useState<BulkProgress | null>(null);
  const [outcome, setOutcome] = useState<BulkOutcome | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [pasted, setPasted] = useState<Set<string>>(new Set());
  const cancelled = useRef(false);

  const links = parseLinks(text);
  const toCheck = plan ? [...plan.fresh, ...plan.already.filter((a) => again.has(a.url)).map((a) => a.url)] : [];
  const estimate = fastModel ? estimateBulkCost(toCheck.length, fastModel) : null;

  // Free: only reads this browser's database.
  const review = async () => {
    const apps = (await db.applications.toArray()) as (Application & {
      id: number;
    })[];
    setFastModel((await getSettings()).fastModel);
    setPlan(planBulk(links, apps));
    setAgain(new Set());
    setPhase("confirm");
  };

  const run = async () => {
    if (phase !== "confirm" || toCheck.length === 0) return;
    cancelled.current = false;
    setCancelling(false);
    setPhase("running");
    setProgress({ index: 0, total: toCheck.length, url: toCheck[0] });
    let result: BulkOutcome;
    try {
      const [provider, prefs, master, profile] = await Promise.all([
        getProvider("check_job"),
        getPreferences(),
        getMasterProfile(),
        getProfile(),
      ]);
      const today = todayISO();
      result = await runBulkCheck(
        toCheck,
        async (url) => {
          const jdText = await readJobPosting(provider, url);
          return saveAnalyzedJob(await analyzeJob(provider, { url, jdText }, prefs, master, today, profile));
        },
        { onProgress: setProgress, isCancelled: () => cancelled.current },
      );
    } catch (e) {
      // No key (or settings unreadable): nothing was tried.
      result = {
        checked: [],
        needsPaste: [],
        failed: [],
        cancelled: false,
        notTried: toCheck,
        stoppedBy: e,
      };
    }
    setOutcome(result);
    setPhase("done");
  };

  if (phase === "enter") {
    return (
      <>
        <TextArea label="Job links, one per line" value={text} onChange={setText} rows={8} />
        <p className="mt-2 text-xs leading-relaxed text-muted">
          {links.length ? `${links.length} link${links.length === 1 ? "" : "s"} found. ` : ""}
          Nothing is read until you review the list and confirm.
        </p>
        <Footer>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => void review()} disabled={links.length === 0}>
            Review {links.length || ""} link{links.length === 1 ? "" : "s"}
          </Button>
        </Footer>
      </>
    );
  }

  if (phase === "confirm" && plan) {
    return (
      <>
        <div className="rounded-2xl bg-paper p-5">
          <p className="text-[17px] font-semibold tracking-display">
            {toCheck.length === 0 ? "Nothing new to check" : `Check ${toCheck.length} job${toCheck.length === 1 ? "" : "s"}`}
          </p>
          {toCheck.length > 0 && estimate && (
            <p className="mt-1 text-sm text-muted">
              {formatEstimate(estimate).replace(/^a/, "A")} in total
              {estimate.known ? "" : " (estimate, your fast model's price isn't listed)"}. One at a time, and you can stop at any point.
            </p>
          )}
        </div>
        {plan.already.length > 0 && (
          <div className="mt-4">
            <p className="mb-2 text-sm font-medium">Already checked, skipped</p>
            <ul className="grid gap-2">
              {plan.already.map(({ url, app }) => {
                const line = jobLine(app);
                return (
                  <li key={url} className="rounded-2xl border border-black/[0.06] px-4 py-3 text-sm">
                    <p className="font-medium">{line.title}</p>
                    {line.detail && <p className="text-muted">{line.detail}</p>}
                    <div className="mt-2">
                      <Checkbox
                        label="Check it again"
                        checked={again.has(url)}
                        onChange={(on) =>
                          setAgain((s) => {
                            const next = new Set(s);
                            if (on) next.add(url);
                            else next.delete(url);
                            return next;
                          })
                        }
                      />
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
        <Footer>
          <Button variant="secondary" onClick={() => setPhase("enter")}>
            Back
          </Button>
          <Button onClick={() => void run()} disabled={toCheck.length === 0}>
            Check {toCheck.length} job{toCheck.length === 1 ? "" : "s"}
          </Button>
        </Footer>
      </>
    );
  }

  if (phase === "running" && progress) {
    const pct = Math.round((progress.index / progress.total) * 100);
    return (
      <>
        <div className="rounded-2xl bg-paper p-5" role="status" aria-live="polite">
          <p className="text-[15px] font-semibold tracking-display">
            Checking {progress.index + 1} of {progress.total}
          </p>
          <p className="mt-1 truncate text-sm text-muted">{host(progress.url)}</p>
          <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-black/[0.06]">
            <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${Math.max(4, pct)}%` }} />
          </div>
        </div>
        <Footer>
          <Button
            variant="secondary"
            disabled={cancelling}
            onClick={() => {
              cancelled.current = true;
              setCancelling(true);
            }}
          >
            {cancelling ? "Stopping after this one..." : "Stop"}
          </Button>
        </Footer>
      </>
    );
  }

  if (phase === "done" && outcome) {
    const n = outcome.checked.length;
    return (
      <>
        <div className="rounded-2xl bg-paper p-5" role="status">
          <p className="text-[17px] font-semibold tracking-display">
            {n === 0 ? "No jobs checked" : `Checked ${n} job${n === 1 ? "" : "s"}`}
          </p>
          {n > 0 && <p className="mt-1 text-sm text-muted">They&apos;re under Checked jobs.</p>}
          {outcome.cancelled && outcome.notTried.length > 0 && (
            <p className="mt-1 text-sm text-muted">
              Stopped. {outcome.notTried.length} link
              {outcome.notTried.length === 1 ? " wasn't" : "s weren't"} read.
            </p>
          )}
        </div>
        {outcome.stoppedBy !== undefined && (
          <>
            <AIErrorNotice error={outcome.stoppedBy} />
            <p className="mt-2 text-sm text-muted">
              Stopped here, since every other link would hit the same problem. {outcome.notTried.length} link
              {outcome.notTried.length === 1 ? " wasn't" : "s weren't"} read.
            </p>
          </>
        )}
        {n > 0 && (
          <ul className="mt-4 grid gap-2">
            {outcome.checked.map((app) => {
              const line = jobLine(app);
              return (
                <li
                  key={app.id}
                  className="flex items-baseline justify-between gap-3 rounded-2xl border border-black/[0.06] px-4 py-3 text-sm"
                >
                  <span className="font-medium">{line.title}</span>
                  <span className="shrink-0 text-muted">{line.detail}</span>
                </li>
              );
            })}
          </ul>
        )}
        {outcome.needsPaste.length > 0 && (
          <div className="mt-5">
            <p className="text-sm font-medium">These pages need their text pasted</p>
            <p className="mb-2 text-xs text-muted">Their sites load the posting with JavaScript, so a link can&apos;t be read.</p>
            <ul className="grid gap-2">
              {outcome.needsPaste.map(({ url }) => (
                <li key={url} className="flex items-center justify-between gap-3 rounded-2xl border border-black/[0.06] px-4 py-3 text-sm">
                  <span className="min-w-0 truncate">{host(url)}</span>
                  <Button
                    size="sm"
                    variant={pasted.has(url) ? "secondary" : "tinted"}
                    onClick={() => {
                      setPasted((s) => new Set(s).add(url));
                      onPaste(url);
                    }}
                  >
                    {pasted.has(url) ? "Paste again" : "Paste"}
                  </Button>
                </li>
              ))}
            </ul>
          </div>
        )}
        {outcome.failed.length > 0 && (
          <div className="mt-5">
            <p className="mb-2 text-sm font-medium">Couldn&apos;t check</p>
            <ul className="grid gap-2 text-sm">
              {outcome.failed.map(({ url, message }) => (
                <li key={url} className="rounded-2xl border border-black/[0.06] px-4 py-3">
                  <p className="truncate font-medium">{host(url)}</p>
                  <p className="text-muted">{message}</p>
                </li>
              ))}
            </ul>
          </div>
        )}
        <Footer>
          <Button onClick={onClose}>Done</Button>
        </Footer>
      </>
    );
  }

  return null;
}

function Footer({ children }: { children: React.ReactNode }) {
  return <div className="mt-5 flex flex-wrap items-center justify-end gap-3 border-t border-black/[0.06] pt-5">{children}</div>;
}
