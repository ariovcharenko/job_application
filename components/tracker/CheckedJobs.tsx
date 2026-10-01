"use client";

import { useState } from "react";
import { verdictFor, VERDICT_TEXT } from "@/lib/intake/decision";
import { readBreakdown } from "@/lib/intake/stored";
import type { Application } from "@/lib/types";
import { Button } from "@/components/ui";
import { CompanyMark } from "./StageBadge";

/** "95% · Apply", "0% · Weak match", "Don't apply", from the job's saved check. */
function verdictLine(app: Application): { text: string; strong: boolean } | null {
  const b = readBreakdown(app);
  if (!b?.decision) return null;
  const pct = b.skills?.percent ?? null;
  const v = verdictFor(b.decision, pct);
  return { text: `${pct === null ? "" : `${pct}% · `}${VERDICT_TEXT[v].label}`, strong: v === "apply" };
}

const checkedOn = (app: Application) => new Date(app.updatedAt || app.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric" });

function Row({ app, onOpen, children }: { app: Application; onOpen: () => void; children: React.ReactNode }) {
  const verdict = verdictLine(app);
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-2 py-3">
      <CompanyMark name={app.company} />
      <button type="button" onClick={onOpen} className="min-w-0 flex-1 rounded text-left focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-accent/25">
        <span className="block truncate font-medium">{app.company || "Untitled"}</span>
        <span className="block truncate text-[13px] text-muted">
          {app.role || "Role not set"} · checked {checkedOn(app)}
        </span>
      </button>
      {verdict && (
        <span
          className={`whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-semibold tabular-nums ${verdict.strong ? "bg-accent-soft text-accent-deep" : "bg-black/[0.05] text-muted"}`}
        >
          {verdict.text}
        </span>
      )}
      <div className="flex w-full flex-wrap gap-2 pl-10 sm:w-auto sm:pl-0">{children}</div>
    </li>
  );
}

type Action = (a: Application) => unknown;

/**
 * Jobs she checked but hasn't turned into applications. They stay out of the table and the stats,
 * and are remembered so a repeat check of the same position is recognized. Each move says what
 * happened, with an Undo, since the row disappears from where she was looking.
 */
export default function CheckedJobs({
  apps,
  onOpen,
  onTrack,
  onSkip,
  onRestore,
}: {
  apps: Application[];
  onOpen: (a: Application) => void;
  onTrack: Action;
  onSkip: Action;
  onRestore: Action;
}) {
  const [busy, setBusy] = useState<number | null>(null);
  const [notice, setNotice] = useState<{ text: string; undo: () => unknown } | null>(null);

  const run = async (a: Application, action: Action, text: string, undo: () => unknown) => {
    if (busy !== null) return;
    setBusy(a.id ?? -1);
    try {
      await action(a);
      setNotice({ text, undo });
    } finally {
      setBusy(null);
    }
  };
  const name = (a: Application) => a.company || a.role || "Job";

  const deciding = apps.filter((a) => a.triage === "checked").sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  const skipped = apps.filter((a) => a.triage === "skipped").sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  if (deciding.length === 0 && skipped.length === 0 && !notice) return null;

  return (
    <section className="mt-12" aria-labelledby="checked-jobs-title">
      <h2 id="checked-jobs-title" className="text-[24px] font-semibold tracking-display sm:text-[28px]" title="Jobs you checked but haven't added to your applications">
        Checked jobs {deciding.length > 0 && <span className="font-normal tabular-nums text-muted">{deciding.length}</span>}
      </h2>

      <div aria-live="polite">
        {notice && (
          <p className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-2xl bg-white px-4 py-3 text-sm shadow-soft">
            <span>{notice.text}</span>
            <button
              type="button"
              className="font-medium text-accent hover:underline"
              onClick={async () => {
                const { undo } = notice;
                setNotice(null);
                await undo();
              }}
            >
              Undo
            </button>
            <button type="button" aria-label="Dismiss" className="ml-auto rounded-full p-1 text-muted hover:text-ink" onClick={() => setNotice(null)}>
              <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                <path d="M6 6l12 12M18 6 6 18" />
              </svg>
            </button>
          </p>
        )}
      </div>

      {deciding.length > 0 && (
        <ul className="mt-4 divide-y divide-black/[0.06] rounded-[22px] bg-white px-4 shadow-soft sm:px-5">
          {deciding.map((a) => (
            <Row key={a.id} app={a} onOpen={() => onOpen(a)}>
              <Button disabled={busy !== null} onClick={() => run(a, onTrack, `${name(a)} moved to your applications.`, () => onRestore(a))}>
                Add to applications
              </Button>
              <Button variant="secondary" disabled={busy !== null} onClick={() => run(a, onSkip, `${name(a)} marked as not applying.`, () => onRestore(a))}>
                Not applying
              </Button>
            </Row>
          ))}
        </ul>
      )}

      {skipped.length > 0 && (
        <details className="group mt-4 rounded-[22px] bg-white px-4 py-3 shadow-soft sm:px-5">
          <summary className="flex cursor-pointer list-none items-center justify-between rounded-lg py-1 text-[15px] font-medium focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-accent/25">
            <span>
              Not applying <span className="font-normal tabular-nums text-muted">{skipped.length}</span>
            </span>
            <svg viewBox="0 0 24 24" className="h-4 w-4 text-muted transition group-open:rotate-180" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <path d="m6 9 6 6 6-6" />
            </svg>
          </summary>
          <ul className="divide-y divide-black/[0.06]">
            {skipped.map((a) => (
              <Row key={a.id} app={a} onOpen={() => onOpen(a)}>
                <Button
                  variant="secondary"
                  disabled={busy !== null}
                  onClick={() => run(a, onRestore, `${name(a)} is back under Checked jobs.`, () => onSkip(a))}
                >
                  Reconsider
                </Button>
              </Row>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
