import { DEFAULT_PREFERENCES } from "@/lib/defaults";
import { companyInitials } from "@/lib/tracker/initials";
import type { Stage } from "@/lib/types";

/** One color per stage, so the table reads at a glance: gray to do, purple applied, amber interview, green offer, red rejected. */
export const STAGE_STYLE: Record<Stage, string> = {
  Saved: "bg-black/[0.05] text-black/65",
  Applied: "bg-accent-soft text-accent-deep",
  "Waiting for interview": "bg-warn-soft text-warn",
  Offer: "bg-good-soft text-good",
  Rejected: "bg-bad-soft text-bad",
};

/** A solid dot per stage (chips, legends), so the stage color still reads where the pill's soft tint would be too faint. */
export const STAGE_DOT: Record<Stage, string> = {
  Saved: "bg-black/30",
  Applied: "bg-accent",
  "Waiting for interview": "bg-warn",
  Offer: "bg-good",
  Rejected: "bg-bad",
};

/** The small pill-shaped stage menu used on table rows and board cards. */
export const STAGE_SELECT_CLASS =
  "max-w-full cursor-pointer truncate rounded-full border-0 py-1 pl-2.5 pr-7 text-xs font-medium outline-none focus:ring-2 focus:ring-accent/30";

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

/**
 * Tile sizes. The corner radius stays about 27% of the side (the macOS icon proportion), and two
 * letters are set smaller than one so both fill the tile about the same.
 */
const MARK_SIZE = {
  sm: { box: "h-8 w-8 rounded-[9px]", one: "text-[15px]", two: "text-[12px]", icon: "h-4 w-4" },
  md: { box: "h-10 w-10 rounded-[11px]", one: "text-[18px]", two: "text-[15px]", icon: "h-[18px] w-[18px]" },
} as const;

/**
 * A company's monogram on a white tile with a hairline edge ("Atlas Cloud" -> "AC"). Neutral on
 * purpose: no per-company colors and no fetched logos, so every row looks equally calm. A name with
 * nothing usable gets a small building icon instead of a made-up letter.
 */
export function CompanyMark({ name, size = "sm" }: { name: string; size?: keyof typeof MARK_SIZE }) {
  const initials = companyInitials(name);
  const s = MARK_SIZE[size];
  return (
    <span
      aria-hidden="true"
      className={`flex shrink-0 select-none items-center justify-center bg-white font-semibold leading-none text-ink/80 shadow-tile ${s.box} ${
        initials.length > 1 ? `${s.two} tracking-[-0.02em]` : s.one
      }`}
    >
      {initials ? (
        // Caps sit a hair high in a centered line box; nudge them down half a pixel to look centered.
        <span className="translate-y-[0.5px]">{initials}</span>
      ) : (
        <svg viewBox="0 0 24 24" className={`${s.icon} text-muted`} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M4 21V5a1 1 0 0 1 1-1h9a1 1 0 0 1 1 1v16M15 10h4a1 1 0 0 1 1 1v10M3 21h18M8 8h3M8 12h3M8 16h3" />
        </svg>
      )}
    </span>
  );
}
