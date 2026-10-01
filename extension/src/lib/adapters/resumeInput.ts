import { findFileInputs } from "../matching";
import { getFieldLabel } from "../matching";

const RESUME_HINT = /resume|r[ée]sum[ée]|\bcv\b/i;

/** Finds the file input most likely meant for a resume: the only file input if there's just one,
 * otherwise the one whose label/name/id mentions "resume" or "CV". Kept ATS-agnostic and shared
 * by every adapter (including the generic one) rather than hardcoding brittle, era-specific class
 * names per platform — those change often and are safer to match this way than to guess wrong. */
export function findResumeInputGeneric(root: ParentNode): HTMLInputElement | null {
  const fileInputs = findFileInputs(root);
  if (fileInputs.length === 0) return null;
  if (fileInputs.length === 1) return fileInputs[0];
  const byHint = fileInputs.find((el) => RESUME_HINT.test(getFieldLabel(el)) || RESUME_HINT.test(el.name) || RESUME_HINT.test(el.id));
  return byHint ?? fileInputs[0];
}
