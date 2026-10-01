import { DEFAULT_PREFERENCES } from "@/lib/defaults";
import type { Stage } from "@/lib/types";

// Neutral by default; color only where the stage means something (in progress, an offer).
/** One color per stage, so the table reads at a glance: gray to do, purple applied, amber interview, green offer, red rejected. */
export const STAGE_STYLE: Record<Stage, string> = {
  Saved: "bg-black/[0.05] text-black/65",
  Applied: "bg-accent-soft text-accent-deep",
  "Waiting for interview": "bg-warn-soft text-warn",
  Offer: "bg-good-soft text-good",
  Rejected: "bg-bad-soft text-bad",
};

/** The small pill-shaped stage menu used on table rows and board cards. */
export const STAGE_SELECT_CLASS =
  "max-w-[150px] cursor-pointer truncate rounded-full border-0 py-1 pl-2.5 pr-7 text-xs font-medium outline-none focus:ring-2 focus:ring-accent/30";

export default function StageBadge({ stage }: { stage: Stage }) {
  return <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${STAGE_STYLE[stage]}`}>{stage}</span>;
}

/** Same bands as scoreJob's verdicts (Apply at the threshold, Maybe from 15 below it). */
export function fitTone(score: number, applyThreshold = DEFAULT_PREFERENCES.applyThreshold) {
  if (score >= applyThreshold) return "bg-accent-soft text-accent-deep ring-transparent";
  if (score >= applyThreshold - 15) return "bg-black/[0.05] text-ink ring-transparent";
  return "bg-black/[0.04] text-muted ring-transparent";
}

export function FitPill({ score }: { score: number }) {
  return (
    <span className={`inline-flex min-w-[2.25rem] justify-center rounded-md px-1.5 py-0.5 text-xs font-semibold tabular-nums ring-1 ring-inset ${fitTone(score)}`}>
      {score}
    </span>
  );
}

/** A company's initial on a neutral tile, so rows are easy to scan without a rainbow of colors. */
export function CompanyMark({ name, size = "sm" }: { name: string; size?: "sm" | "md" }) {
  const letter = (name.trim()[0] ?? "?").toUpperCase();
  const dims = size === "md" ? "h-10 w-10 text-[15px] rounded-xl" : "h-7 w-7 text-xs rounded-lg";
  return (
    <span aria-hidden="true" className={`flex shrink-0 items-center justify-center bg-black/[0.06] font-semibold text-black/60 ${dims}`}>
      {letter}
    </span>
  );
}
