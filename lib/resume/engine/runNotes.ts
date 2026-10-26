// Plain-words notes for the tailoring screen, kept as pure functions so they can be tested.

/** After this many seconds of a run, say it is taking longer than usual. */
export const SLOW_AFTER_SECONDS = 60;
export const SLOW_NOTE = "Taking longer than usual. You can keep waiting or Cancel.";
export const POLISH_FAILED_NOTE = "Couldn't polish it. Your draft is kept.";

export const isSlow = (seconds: number): boolean => seconds >= SLOW_AFTER_SECONDS;

/**
 * True when the automatic polish pass ran (two calls) but did not improve the draft, and she did
 * not skip it herself: the draft was kept because the polish failed or came back unusable.
 */
export function polishFailed(out: { calls: number; notes: string[] }, skippedByUser: boolean): boolean {
  if (skippedByUser || out.calls < 2) return false;
  return !out.notes.some((n) => n.startsWith("Polished automatically"));
}

/** What to tell her when an update finishes: how many spots are marked in yellow. */
export function updateDoneMessage(marks: number): string {
  if (marks <= 0) return "Update finished. Nothing on the page changed.";
  return `Update finished. ${marks} spot${marks === 1 ? " is" : "s are"} marked in yellow.`;
}

export const addedSkillMessage = (skill: string): string => `Added ${skill} to your Skills line.`;
