"use client";

import type { QualityIssue } from "@/lib/resume/quality/types";
import { Button } from "@/components/ui";

/**
 * Writing quality of the tailored page, checked by code (lib/resume/quality): the "fix" issues
 * (AI-sounding words, weak or repeated verbs, overlong bullets, bold misuse...) can be sent back as
 * targeted comments in one click; "consider" issues are suggestions she judges herself.
 */
export default function QualityCard({
  score,
  issues,
  onFix,
  queued,
  disabled,
  costHint,
}: {
  score: number;
  issues: QualityIssue[];
  onFix: () => void;
  queued: boolean;
  disabled?: boolean;
  costHint: string;
}) {
  const fix = issues.filter((i) => i.severity === "fix");
  const consider = issues.filter((i) => i.severity === "consider");

  return (
    <section className="rounded-2xl border border-black/[0.08] bg-white p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-[15px] font-semibold tracking-display">Writing quality</h3>
        <p className="text-[13px] text-muted">
          <span className={`font-semibold tabular-nums ${score >= 80 ? "text-accent-deep" : "text-warn"}`}>{score}</span>/100
        </p>
      </div>

      {issues.length === 0 ? (
        <p className="mt-2 text-[13px] text-muted">
          No weak verbs, buzzwords, repetition or overlong bullets found. Reads like a person wrote it.
        </p>
      ) : (
        <>
          {fix.length > 0 && (
            <>
              <p className="mt-3 text-[13px] font-medium">
                {fix.length} thing{fix.length === 1 ? "" : "s"} to fix
              </p>
              <ul className="mt-1.5 grid gap-1.5 text-[13px]">
                {fix.map((i) => (
                  <li key={i.id} className="flex gap-2">
                    <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-warn" aria-hidden="true" />
                    <span>
                      {i.message}
                      {i.quote && <span className="mt-0.5 line-clamp-1 block text-xs text-muted">&ldquo;{i.quote}&rdquo;</span>}
                    </span>
                  </li>
                ))}
              </ul>
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <Button variant="secondary" onClick={onFix} disabled={disabled || queued}>
                  {queued ? "Added to your comments" : `Fix ${fix.length === 1 ? "it" : `these ${fix.length}`}`}
                </Button>
                <span className="text-xs text-muted">Adds one comment per spot. Sent with Update resume ({costHint}).</span>
              </div>
            </>
          )}
          {consider.length > 0 && (
            <details className="mt-3 text-[13px]">
              <summary className="cursor-pointer text-muted">
                {consider.length} suggestion{consider.length === 1 ? "" : "s"} to consider
              </summary>
              <ul className="mt-1.5 grid gap-1.5">
                {consider.map((i) => (
                  <li key={i.id} className="text-muted">
                    {i.message}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </>
      )}
    </section>
  );
}
