import { REMOTE_US } from "../geo/choices";
import type { WorkMode } from "../options";
import type { Preferences } from "../types";

// "Remote" in work styles and "Remote (US)" in locations are one concept, edited in two places.
// These keep them in step on every change (pure, so the UI and tests share them).

/** New location choices from the picker. */
export function withLocations(prev: Preferences, next: string[]): Preferences {
  const had = prev.locations.includes(REMOTE_US);
  let locations = next;
  let workModes = prev.workModes;
  if (had && !next.includes(REMOTE_US)) workModes = workModes.filter((m) => m !== "Remote");
  if (!had && next.includes(REMOTE_US) && !workModes.includes("Remote")) workModes = [...workModes, "Remote"];
  // Her first choice: the Remote work style she already has comes along as Remote (US).
  if (prev.locations.length === 0 && next.length > 0 && !next.includes(REMOTE_US) && workModes.includes("Remote")) locations = [REMOTE_US, ...next];
  return { ...prev, locations, workModes };
}

/** New work styles from the chips. */
export function withWorkModes(prev: Preferences, modes: WorkMode[]): Preferences {
  const was = prev.workModes.includes("Remote");
  const is = modes.includes("Remote");
  let locations = prev.locations;
  if (was && !is) locations = locations.filter((l) => l !== REMOTE_US);
  if (!was && is && !locations.includes(REMOTE_US)) locations = [REMOTE_US, ...locations];
  return { ...prev, workModes: modes, locations };
}
