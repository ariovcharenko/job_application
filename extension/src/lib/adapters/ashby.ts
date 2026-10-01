import type { AtsAdapter } from "./types";
import { findResumeInputGeneric } from "./resumeInput";

// Ashby's React app uses generated class names that change across deploys, so this leans almost
// entirely on the generic, label-based detection rather than guessing CSS classes that would
// likely be wrong. Hostname match is the reliable part.
export const ashbyAdapter: AtsAdapter = {
  name: "ashby",
  matches: (location) => /(^|\.)ashbyhq\.com$/i.test(location.hostname),
  findFormRoot(doc) {
    return doc.querySelector("form") ?? doc.body;
  },
  findResumeInput(doc) {
    return findResumeInputGeneric(doc.body);
  },
};
