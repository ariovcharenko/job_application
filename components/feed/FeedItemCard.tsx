"use client";

import { useState } from "react";
import type { ScoreResult } from "@/lib/scoring/score";
import type { FeedItem } from "@/lib/types";
import { safeHttpUrl } from "@/lib/safeUrl";
import { Button, ExternalLinkIcon } from "@/components/ui";
import ScoreCard, { VerdictBadge } from "@/components/tracker/ScoreCard";
import { CompanyMark, fitTone } from "@/components/tracker/StageBadge";

function parseBreakdown(item: FeedItem): ScoreResult | null {
  if (!item.fitBreakdown) return null;
  try {
    return JSON.parse(item.fitBreakdown) as ScoreResult;
  } catch {
    return null;
  }
}

export default function FeedItemCard({
  item,
  onStart,
  onDismiss,
}: {
  item: FeedItem;
  onStart: (item: FeedItem) => void;
  onDismiss: (id: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const breakdown = parseBreakdown(item);

  return (
    <article className="rounded-[22px] bg-white p-5 shadow-soft transition hover:shadow-lift">
      <div className="flex items-start gap-4">
        <CompanyMark name={item.company} size="md" />
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-medium text-muted">{item.company}</p>
          <p className="mt-0.5 font-semibold leading-snug tracking-tight">{item.title}</p>
          <p className="mt-1 flex flex-wrap items-center gap-x-2 text-sm text-muted">
            {item.location && <span>{item.location}</span>}
            {item.workMode !== "Unknown" && (
              <span className="rounded-md bg-black/[0.05] px-1.5 py-0.5 text-[11px] font-medium text-muted">{item.workMode}</span>
            )}
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1.5">
          {item.fitScore != null ? (
            <span className={`rounded-xl px-2.5 py-1 text-lg font-semibold tabular-nums ring-1 ring-inset ${fitTone(item.fitScore)}`}>
              {item.fitScore}
            </span>
          ) : (
            <span className="text-lg font-semibold text-muted">—</span>
          )}
          {breakdown && <VerdictBadge verdict={breakdown.verdict} />}
        </div>
      </div>

      {open && breakdown && (
        <div className="mt-4">
          <ScoreCard result={breakdown} />
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-black/[0.06] pt-4">
        {item.state === "started" ? (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-good-soft px-3 py-2 text-sm font-medium text-good">
            ✓ Added to tracker
          </span>
        ) : (
          <Button onClick={() => onStart(item)}>Start application</Button>
        )}
        {item.state === "dismissed" ? (
          <span className="px-2 text-sm text-muted">Dismissed</span>
        ) : (
          item.state !== "started" && (
            <Button variant="secondary" onClick={() => item.id !== undefined && onDismiss(item.id)}>
              Dismiss
            </Button>
          )
        )}
        {item.tailorDraft && item.state !== "started" && (
          <span className="rounded-full bg-accent-soft px-2.5 py-1 text-xs font-medium text-accent-deep">Tailored draft ready</span>
        )}
        <div className="ml-auto flex flex-wrap items-center gap-4 text-sm">
          {breakdown && (
            <button type="button" onClick={() => setOpen((o) => !o)} className="font-medium text-muted hover:text-ink">
              {open ? "Hide details" : "Why this score"}
            </button>
          )}
          {safeHttpUrl(item.url) && (
            <a
              href={safeHttpUrl(item.url)}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 font-medium text-accent hover:underline"
            >
              Open posting
              <ExternalLinkIcon />
            </a>
          )}
        </div>
      </div>
    </article>
  );
}
