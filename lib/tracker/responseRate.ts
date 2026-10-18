import type { Application, Stage } from "../types";

// The tracker's response rate, from stages only. Reply dates are not used: older versions stamped
// today's date when a job was moved to Rejected, so they over-count, and the stored rows are left as
// they are. respondDate stays a field she can see, edit and export.

/** Stages that mean they replied: an interview, an offer, or a rejection (a rejection is a reply). */
export const HEARD_BACK_STAGES: ReadonlySet<Stage> = new Set<Stage>(["Waiting for interview", "Offer", "Rejected"]);

/** Applied or later. Saved hasn't been sent; Withdrawn is left out (she pulled it, so no reply is due). */
export function inAppliedPool(stage: Stage): boolean {
  return stage !== "Saved" && stage !== "Withdrawn";
}

export interface ResponseStats {
  applied: number;
  heardBack: number;
  /** Whole percent, 0 when nothing has been applied to. */
  rate: number;
}

/** Response rate over tracked jobs (the caller leaves out checked and skipped ones, as the table does). */
export function responseStats(apps: readonly Pick<Application, "stage">[]): ResponseStats {
  const pool = apps.filter((a) => inAppliedPool(a.stage));
  const heardBack = pool.filter((a) => HEARD_BACK_STAGES.has(a.stage)).length;
  return { applied: pool.length, heardBack, rate: pool.length ? Math.round((heardBack / pool.length) * 100) : 0 };
}

/** The stat's tooltip. */
export const responseRateTitle = (s: ResponseStats) => `${s.heardBack} of ${s.applied} applied heard back: interview, offer or rejection`;
