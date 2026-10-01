"use client";

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

/**
 * Jobs she checked but hasn't turned into applications. They stay out of the table and the stats,
 * and are remembered so a repeat check of the same position is recognized.
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
  onTrack: (a: Application) => void;
  onSkip: (a: Application) => void;
  onRestore: (a: Application) => void;
}) {
  const deciding = apps.filter((a) => a.triage === "checked").sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  const skipped = apps.filter((a) => a.triage === "skipped").sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  if (deciding.length === 0 && skipped.length === 0) return null;

  return (
    <section className="mt-12">
      <h2 className="text-[24px] font-semibold tracking-display sm:text-[28px]">Checked jobs</h2>
      <p className="mt-1 max-w-2xl text-[15px] text-muted">
        Jobs you checked but haven&apos;t added to your applications. Checking one of them again is recognized, so you won&apos;t pay twice.
      </p>

      {deciding.length > 0 && (
        <ul className="mt-5 divide-y divide-black/[0.06] rounded-[22px] bg-white px-4 shadow-soft sm:px-5">
          {deciding.map((a) => (
            <Row key={a.id} app={a} onOpen={() => onOpen(a)}>
              <Button onClick={() => onTrack(a)}>Add to applications</Button>
              <Button variant="secondary" onClick={() => onSkip(a)}>
                Not applying
              </Button>
            </Row>
          ))}
        </ul>
      )}

      {skipped.length > 0 && (
        <details className="group mt-4 rounded-[22px] bg-white px-4 py-3 shadow-soft sm:px-5">
          <summary className="flex cursor-pointer list-none items-center justify-between py-1 text-[15px] font-medium">
            <span>
              Not applying <span className="font-normal text-muted">({skipped.length})</span>
            </span>
            <svg viewBox="0 0 24 24" className="h-4 w-4 text-muted transition group-open:rotate-180" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <path d="m6 9 6 6 6-6" />
            </svg>
          </summary>
          <ul className="divide-y divide-black/[0.06]">
            {skipped.map((a) => (
              <Row key={a.id} app={a} onOpen={() => onOpen(a)}>
                <Button variant="secondary" onClick={() => onRestore(a)}>
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
