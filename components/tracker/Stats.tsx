"use client";

import { useEffect, useState } from "react";
import { getPreferences, savePreferences } from "@/lib/db";
import { withGoal, type GoalPeriod } from "@/lib/tracker/weeklyGoal";
import { Button, inputClass, panelClass, textButtonClass } from "@/components/ui";

/** One figure in the stats row. The row is a single panel split by hairlines, not separate boxes. */
export function Stat({ label, value, title, action, className = "", children }: { label: string; value: React.ReactNode; title?: string; action?: React.ReactNode; className?: string; children?: React.ReactNode }) {
  return (
    <div className={`min-w-0 px-4 py-4 sm:px-6 ${className}`} title={title}>
      <div className="flex items-center justify-between gap-2">
        <dt className="truncate text-[12px] text-muted sm:text-[13px]">{label}</dt>
        {action}
      </div>
      <dd className="mt-1 text-[28px] font-semibold leading-tight tracking-display tabular-nums">{value}</dd>
      {children}
    </div>
  );
}

/** The goal tile is tinted so it stands out from the plain counts: soft purple, green once reached. */
const GOAL_TILE = "rounded-l-[22px] bg-accent-soft";
const GOAL_TILE_DONE = "rounded-l-[22px] bg-good-soft";

const smallLink = "shrink-0 rounded-full text-[12px] font-medium text-accent hover:text-accent-deep hover:underline underline-offset-2 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-accent/25 sm:text-[13px]";

/**
 * The goal tile. With a goal: "2 of 5" today (or this week), a thin bar that turns purple once it's
 * reached, and "3 to go". Without one: an invitation to set it, since it's optional.
 */
export function GoalStat({ done, goal, per, onEdit }: { done: number; goal: number | null; per: GoalPeriod; onEdit: () => void }) {
  if (!goal) {
    return (
      <Stat label="Daily goal" className={GOAL_TILE} value={<button type="button" onClick={onEdit} className={`${textButtonClass} -ml-2 text-[17px]`}>Set a goal</button>}>
        <p className="mt-1.5 truncate text-[12px] text-muted">Optional reminder</p>
      </Stat>
    );
  }
  const pct = Math.min(100, Math.round((done / goal) * 100));
  const left = goal - done;
  const when = per === "day" ? "today" : "this week";
  return (
    <Stat
      className={done >= goal ? GOAL_TILE_DONE : GOAL_TILE}
      label={per === "day" ? "Today" : "This week"}
      title={`${done} of your goal of ${goal} applications ${per === "day" ? "today" : "this week, Monday to Sunday"}`}
      action={<button type="button" onClick={onEdit} className={smallLink}>Edit</button>}
      value={
        <>
          {done}
          <span className="text-[17px] font-normal text-muted"> of {goal}</span>
        </>
      }
    >
      <div
        className={`mt-2 h-1 overflow-hidden rounded-full ${done >= goal ? "bg-good/20" : "bg-accent/20"}`}
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={goal}
        aria-valuenow={Math.min(done, goal)}
        aria-label={per === "day" ? "Daily goal progress" : "Weekly goal progress"}
      >
        <div className={`h-full rounded-full ${done >= goal ? "bg-good" : "bg-accent"}`} style={{ width: `${pct}%` }} />
      </div>
      <p className="mt-1.5 truncate text-[12px] text-muted">{left > 0 ? `${left} to go ${when}` : `Goal reached ${when}`}</p>
    </Stat>
  );
}

const QUICK_PICKS = [3, 5, 10, 15];

/** Set, change or turn off the goal right from the Tracker. Saves to Job preferences. */
export function GoalEditor({ goal, onClose }: { goal: { count: number; per: GoalPeriod } | null; onClose: () => void }) {
  const [count, setCount] = useState(goal ? String(goal.count) : "5");
  const [per, setPer] = useState<GoalPeriod>(goal?.per ?? "day");
  const n = Math.round(Number(count));
  const valid = Number.isFinite(n) && n > 0;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const save = async (value: number) => {
    await savePreferences(withGoal(await getPreferences(), value, per));
    onClose();
  };

  const segment = (on: boolean) =>
    `rounded-full px-3.5 py-1.5 text-[13px] font-medium transition focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-accent/25 ${
      on ? "bg-white text-ink shadow-sm" : "text-muted hover:text-ink"
    }`;
  const chip = (on: boolean) =>
    `rounded-full px-3 py-1.5 text-[13px] font-medium tabular-nums transition focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-accent/25 ${
      on ? "bg-accent text-white" : "bg-black/[0.05] text-ink hover:bg-black/[0.08]"
    }`;

  return (
    <section className={`${panelClass} -mt-5 mb-8 p-5 sm:p-6`} aria-label="Application goal">
      <h3 className="text-[15px] font-semibold">How many jobs do you want to apply to?</h3>
      <p className="mt-1 text-[13px] text-muted">A reminder only, never required. Jobs count on the day you mark them applied.</p>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        {QUICK_PICKS.map((q) => (
          <button key={q} type="button" className={chip(n === q)} onClick={() => setCount(String(q))}>
            {q}
          </button>
        ))}
        <input
          type="number"
          min={1}
          max={per === "day" ? 50 : 200}
          aria-label="Number of applications"
          value={count}
          onChange={(e) => setCount(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && valid && void save(n)}
          className={`${inputClass} !w-20 !py-1.5`}
        />
        <div className="ml-1 inline-flex rounded-full bg-black/[0.05] p-0.5" role="group" aria-label="Goal period">
          <button type="button" className={segment(per === "day")} aria-pressed={per === "day"} onClick={() => setPer("day")}>
            per day
          </button>
          <button type="button" className={segment(per === "week")} aria-pressed={per === "week"} onClick={() => setPer("week")}>
            per week
          </button>
        </div>
      </div>
      <div className="mt-5 flex flex-wrap items-center gap-2">
        <Button disabled={!valid} onClick={() => void save(n)}>
          Save goal
        </Button>
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        {goal && (
          <button type="button" className={`${textButtonClass} ml-auto text-muted hover:text-ink`} onClick={() => void save(0)}>
            Turn off goal
          </button>
        )}
      </div>
    </section>
  );
}
