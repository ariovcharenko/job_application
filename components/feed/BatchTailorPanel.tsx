"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { getProvider } from "@/lib/ai";
import { AIError } from "@/lib/ai/provider";
import { getBaseResumes, getSettings } from "@/lib/db";
import { parseDocx } from "@/lib/docx/parse";
import { MODEL_OPTIONS } from "@/lib/options";
import {
  estimateBatchCost,
  formatUsd,
  runBatchTailor,
  type BatchCostEstimate,
  type BatchOutcome,
  type BatchProgress,
} from "@/lib/resume/batch";
import type { BaseResume, FeedItem } from "@/lib/types";
import { Button, Field, Notice } from "@/components/ui";

interface Plan {
  resumes: BaseResume[];
  resumeChars: number;
  needsPdfParse: boolean;
  smartModel: string;
  fastModel: string;
}

/** Plain-text length of each base resume, for the estimate. Free for .docx; for a .pdf it's only
 * known once its structure is cached, otherwise a typical one-page length is assumed. */
async function planFor(): Promise<Plan> {
  const [settings, resumes] = await Promise.all([getSettings(), getBaseResumes()]);
  let resumeChars = 0;
  let needsPdfParse = false;
  for (const r of resumes) {
    let chars = 4500;
    if (r.format === "docx") chars = (await parseDocx(r.bytes)).fullText.length;
    else if (r.structure) chars = (JSON.parse(r.structure) as { fullText?: string }).fullText?.length ?? chars;
    else needsPdfParse = true;
    resumeChars = Math.max(resumeChars, chars);
  }
  return { resumes, resumeChars, needsPdfParse, smartModel: settings.smartModel, fastModel: settings.fastModel };
}

const modelLabel = (id: string) => MODEL_OPTIONS.find((m) => m.id === id)?.label.replace(/\s*\(.*\)$/, "") ?? id;

/** "Auto-tailor every strong match" (decision #9), with the safeguard she asked for: the count and
 * a cost estimate are shown first, and nothing is spent until she confirms. Only drafts come out
 * of this; each one is still reviewed bullet by bullet in the Tailor dialog. */
export default function BatchTailorPanel({ matches }: { matches: FeedItem[] }) {
  const [plan, setPlan] = useState<Plan | null>(null);
  const [limit, setLimit] = useState(0);
  const [preparing, setPreparing] = useState(false);
  const [progress, setProgress] = useState<BatchProgress | null>(null);
  const [outcome, setOutcome] = useState<BatchOutcome | null>(null);
  const [error, setError] = useState<{ message: string; needsSettings: boolean } | null>(null);
  const cancelled = useRef(false);

  const running = progress !== null;
  const chosen = matches.slice(0, limit || matches.length);
  const estimate: BatchCostEstimate | null = plan
    ? estimateBatchCost({
        jdLengths: chosen.map((i) => i.jdText.length),
        resumeChars: plan.resumeChars,
        resumeCount: plan.resumes.length,
        needsPdfParse: plan.needsPdfParse,
        smartModel: plan.smartModel,
        fastModel: plan.fastModel,
      })
    : null;

  const review = async () => {
    setError(null);
    setOutcome(null);
    setPreparing(true);
    try {
      const p = await planFor();
      setPlan(p);
      setLimit(matches.length);
    } catch (e) {
      setError({ message: e instanceof Error ? e.message : String(e), needsSettings: false });
    } finally {
      setPreparing(false);
    }
  };

  const run = async () => {
    if (!plan) return;
    setError(null);
    cancelled.current = false;
    setProgress({ done: 0, total: chosen.length });
    try {
      const provider = await getProvider();
      const result = await runBatchTailor(chosen, plan.resumes, provider, {
        smartModel: plan.smartModel,
        onProgress: setProgress,
        isCancelled: () => cancelled.current,
      });
      setOutcome(result);
      setPlan(null);
    } catch (e) {
      const needsSettings = e instanceof AIError && e.kind === "no_key";
      setError({ message: e instanceof Error ? e.message : String(e), needsSettings });
    } finally {
      setProgress(null);
    }
  };

  if (matches.length === 0 && !outcome && !running) return null;

  return (
    <div className="mb-6 rounded-[22px] bg-white p-6 shadow-soft">
      {!plan && !running && matches.length > 0 && (
        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={review} disabled={preparing}>
            {preparing ? "Checking..." : `Tailor ${matches.length} strong match${matches.length === 1 ? "" : "es"}`}
          </Button>
          <span className="text-xs text-muted">Shows the cost first. Nothing runs until you confirm.</span>
        </div>
      )}

      {plan && !running && (
        <>
          <h2 className="font-semibold tracking-tight">Tailor your resume for strong matches</h2>
          {plan.resumes.length === 0 ? (
            <Notice kind="info">
              No base resume imported yet.{" "}
              <Link href="/settings" className="underline">
                Import one in Settings
              </Link>{" "}
              first.
            </Notice>
          ) : (
            <>
              <p className="mt-2 text-sm text-black/70">
                Prepares a tailored draft for each posting with <strong>{modelLabel(plan.smartModel)}</strong>. Drafts
                only: nothing goes into a resume file until you review and save it (Start application, then Tailor
                resume). Suggested new skills stay unticked.
              </p>
              {matches.length > 1 && (
                <div className="mt-3 max-w-[12rem]">
                  <Field
                    label={`How many (best scores first, max ${matches.length})`}
                    type="number"
                    value={String(limit)}
                    onChange={(v) => setLimit(Math.min(matches.length, Math.max(1, Math.round(Number(v)) || 1)))}
                  />
                </div>
              )}
              {estimate && (
                <p className="mt-3 rounded-xl bg-white px-4 py-3 text-sm shadow-soft ring-1 ring-black/[0.06]">
                  {estimate.count} posting{estimate.count === 1 ? "" : "s"}, estimated{" "}
                  <strong>
                    {formatUsd(estimate.lowUsd)}–{formatUsd(estimate.highUsd)}
                  </strong>{" "}
                  in Anthropic credit.
                  <span className="block text-xs text-muted">
                    The upper figure assumes every answer runs to its maximum length, so the real cost should be lower.
                    {plan.needsPdfParse && " Includes reading your PDF resume once."}
                    {!estimate.pricesKnown && " Your selected model isn't in the price list, so a high price was assumed."}{" "}
                    Check your balance in the Anthropic Console if it's low.
                  </span>
                </p>
              )}
              <div className="mt-4 flex gap-3">
                <Button onClick={run}>
                  Tailor {chosen.length} (up to {estimate ? formatUsd(estimate.highUsd) : "—"})
                </Button>
                <Button variant="secondary" onClick={() => setPlan(null)}>
                  Not now
                </Button>
              </div>
            </>
          )}
        </>
      )}

      {running && progress && (
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <span>
            Tailoring {Math.min(progress.done + 1, progress.total)} of {progress.total}
            {progress.current ? `: ${progress.current}` : ""}...
          </span>
          <Button variant="secondary" onClick={() => (cancelled.current = true)}>
            Stop after this one
          </Button>
        </div>
      )}

      {outcome && (
        <Notice kind={outcome.stoppedReason && outcome.stoppedReason !== "Cancelled." ? "error" : "ok"}>
          {outcome.drafted} draft{outcome.drafted === 1 ? "" : "s"} ready. Open a match with Start application, then
          Tailor resume, to review it.
          {outcome.failed.length > 0 &&
            ` Skipped ${outcome.failed.length}: ${outcome.failed.map((f) => `${f.label} (${f.message})`).join("; ")}.`}
          {outcome.stoppedReason && ` Stopped early: ${outcome.stoppedReason}`}
        </Notice>
      )}

      {error && (
        <Notice kind="error">
          {error.message}
          {error.needsSettings && (
            <>
              {" "}
              <Link href="/settings" className="underline">
                Go to Settings
              </Link>
              .
            </>
          )}
        </Notice>
      )}
    </div>
  );
}
