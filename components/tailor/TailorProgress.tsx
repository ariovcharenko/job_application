"use client";

import { useEffect, useState } from "react";
import type { TailorProgress as Progress } from "@/lib/resume/engine/pipeline";

/** About how long a one-page resume's JSON is, to turn characters received into a rough share. */
const TYPICAL_CHARS = 7000;

/**
 * The waiting screen while a resume is written: the current step, how much of the page has
 * arrived, and the seconds so far, so a long call never looks frozen.
 */
export default function TailorProgress({ progress, onCancel, writer }: { progress: Progress | null; onCancel?: () => void; writer?: string | null }) {
  const [started] = useState(() => Date.now());
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);
  const seconds = Math.max(0, Math.round((now - started) / 1000));
  const chars = progress?.chars ?? 0;
  const share = Math.min(95, Math.round((chars / TYPICAL_CHARS) * 100));
  // The polish pass runs with the draft already on screen, so this screen is only ever the writing.
  // Before the first character arrives the model is choosing what from her experience fits the job.
  const label = chars ? "Writing your resume for this job." : "Choosing your most relevant experience for this job.";

  return (
    <div className="rounded-2xl bg-accent-soft/50 p-5" role="status" aria-live="polite">
      <div className="flex items-center gap-2.5 text-sm text-ink">
        <svg className="h-4 w-4 shrink-0 animate-spin text-accent" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
        </svg>
        <span>{label}</span>
      </div>
      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-black/5">
        <div className="h-full rounded-full bg-accent transition-[width] duration-500" style={{ width: `${chars ? Math.max(share, 4) : 2}%` }} />
      </div>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted">
          {seconds}s{writer ? ` · ${writer}` : ""}. Your page shows as soon as it&apos;s written.
        </p>
        {onCancel && (
          <button type="button" onClick={onCancel} className="text-xs font-medium text-muted hover:text-ink">
            Cancel
          </button>
        )}
      </div>
    </div>
  );
}
