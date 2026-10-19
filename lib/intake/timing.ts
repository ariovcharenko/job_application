// Lightweight step timing for a job check (link read, Jev early read, Claude's check, save).
// Numbers only: nothing about the posting is recorded or logged.

export type TimedStep = "read" | "jev" | "claude" | "save";

export interface CheckTiming {
  /** Milliseconds per finished step. A step that never ran (no Jev key) is absent. */
  steps: Partial<Record<TimedStep, number>>;
  /** From the click to now. */
  totalMs: number;
}

export interface CheckTimer {
  start(step: TimedStep): void;
  end(step: TimedStep): void;
  snapshot(): CheckTiming;
}

/** `now` is injectable for tests; the default is performance.now(). */
export function createCheckTimer(now: () => number = () => performance.now()): CheckTimer {
  const t0 = now();
  const starts: Partial<Record<TimedStep, number>> = {};
  const steps: Partial<Record<TimedStep, number>> = {};
  return {
    start(step) {
      starts[step] = now();
    },
    end(step) {
      const s = starts[step];
      if (s !== undefined && steps[step] === undefined) steps[step] = Math.max(0, now() - s);
    },
    snapshot: () => ({ steps: { ...steps }, totalMs: Math.max(0, now() - t0) }),
  };
}

export function formatSeconds(ms: number): string {
  return `${Math.max(0.1, ms / 1000).toFixed(1)}s`;
}

/** The muted line shown after a result. */
export function checkedInLabel(t: CheckTiming): string {
  return `Checked in ${formatSeconds(t.totalMs)}`;
}

/** Hover text with the per-step split, e.g. "Read 0.4s, Claude 3.8s, Save 0.1s". */
export function timingBreakdown(t: CheckTiming): string {
  const names: Record<TimedStep, string> = { read: "Read", jev: "Early read", claude: "Claude", save: "Save" };
  return (Object.keys(names) as TimedStep[])
    .filter((k) => t.steps[k] !== undefined)
    .map((k) => `${names[k]} ${formatSeconds(t.steps[k] as number)}`)
    .join(", ");
}
