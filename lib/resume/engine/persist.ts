import { skillCoverage } from "../coverage";
import type { ResumeHeader } from "./index";
import { tailorResume, type TailorInput, type TailorOutput } from "./pipeline";
import { renderResumeDocx } from "./render";
import type { StoredReview } from "./reviewState";
import { storeJobResume, type NextVersion } from "./save";
import type { ResumeDoc } from "./schema";
import {
  fitResume,
  toVisibleSpot,
  type FitOptions,
  type LayoutMeasureFn,
} from "./trim";
import { applyApprovals, resumeText, type ValidationResult } from "./validate";

// Saves a tailoring result to its job as soon as the AI call returns, inside the call's own code
// path (not in a React effect), so closing the dialog while a resume is being written can't lose
// the paid result. The same steps the screen shows: fit the page, leave out blocked lines she
// hasn't kept, render the .docx, store it (save.ts keeps the version it replaces).

export interface VersionInput {
  header: ResumeHeader;
  result: ValidationResult;
  /** Flag ids she kept. */
  approved: Set<string>;
  measure: LayoutMeasureFn;
  fitOpts: Omit<FitOptions, "restore" | "maxBulletsPerRole">;
  /** The job's skills and her experience, for the before/after coverage shown in the tracker. */
  jobSkills: string[];
  master: string;
  /** The recruiter review to store with it; null clears it (a new draft); left out keeps it. */
  review?: StoredReview | null;
}

/** The final page and what's stored for it. Pure apart from `measure`, so it's testable. */
export function buildVersion(input: VersionInput): {
  final: ResumeDoc;
  stored: NextVersion;
  coverage: { before: number; after: number };
} {
  const { result, approved } = input;
  const fitted = fitResume(result.doc, input.measure, input.fitOpts);
  const visible = result.flags.flatMap((f) => {
    const spot = toVisibleSpot(fitted.map, f.target);
    return spot ? [{ ...f, target: spot }] : [];
  });
  const final = applyApprovals(fitted.doc, visible, approved);
  const onPage = skillCoverage(input.jobSkills, resumeText(final));
  const inProfile = skillCoverage(input.jobSkills, input.master);
  return {
    final,
    stored: {
      v: 2,
      doc: result.doc as ResumeDoc,
      approved: result.flags
        .filter((f) => approved.has(f.id))
        .map((f) => f.message),
      final,
      ...(input.review !== undefined ? { review: input.review } : {}),
    },
    coverage:
      onPage && inProfile
        ? { before: inProfile.percent, after: onPage.percent }
        : { before: 0, after: 0 },
  };
}

/**
 * One tailoring run that saves its result to the job in the same async path, before anything on
 * screen is updated. If the dialog closed meanwhile (the panel unmounted), the result is still
 * stored; only her Cancel (input.signal) stops it, and then nothing is stored.
 */
export async function tailorAndSave(
  input: TailorInput,
  save: {
    applicationId: number;
    header: ResumeHeader;
    fitOpts: VersionInput["fitOpts"];
  },
): Promise<{ out: TailorOutput; id: number | null; saveError?: string }> {
  const out = await tailorResume(input);
  try {
    const id = await persistVersion(save.applicationId, {
      header: save.header,
      result: out.result,
      approved: new Set(),
      measure: input.measure,
      fitOpts: save.fitOpts,
      jobSkills: input.jobSkills,
      master: input.master,
      // A new draft: the last review was about the page it replaces.
      review: null,
    });
    return { out, id };
  } catch (e) {
    // The resume is still shown (and saved again by the panel's autosave); only this save failed.
    return {
      out,
      id: null,
      saveError: e instanceof Error ? e.message : String(e),
    };
  }
}

/** Builds and stores this version for the job. Returns the tailored resume's id. */
export async function persistVersion(
  applicationId: number,
  input: VersionInput,
): Promise<number> {
  const { final, stored, coverage } = buildVersion(input);
  const bytes = await renderResumeDocx(input.header, final);
  return storeJobResume(applicationId, bytes, stored, coverage);
}
