import { loadGeo } from "../geo/index";
import { assessJob, type JobAssessment } from "../intake/analyze";
import { EXAMPLE_EXPERIENCE, EXAMPLE_POSTING, EXAMPLE_PREFERENCES, EXAMPLE_PROFILE, EXAMPLE_SIGNALS } from "./fixture";

/**
 * The example job, checked by the same code as a real one (assessJob, from the bundled signals).
 * No AI call and no database access: the only thing loaded is the bundled place index.
 */
export async function runExample(): Promise<JobAssessment> {
  const geo = await loadGeo();
  return assessJob(EXAMPLE_SIGNALS, EXAMPLE_PREFERENCES, EXAMPLE_EXPERIENCE, EXAMPLE_POSTING, { profile: EXAMPLE_PROFILE, geo });
}
