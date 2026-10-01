import type { AtsAdapter } from "./types";
import { findResumeInputGeneric } from "./resumeInput";

/** Fallback for any ATS without a dedicated adapter: scope to the first real <form> on the page
 * (or the whole document if there isn't one), and find the resume input generically. */
export const genericAdapter: AtsAdapter = {
  name: "generic",
  matches: () => true,
  findFormRoot(doc) {
    return doc.querySelector("form") ?? doc.body;
  },
  findResumeInput(doc) {
    return findResumeInputGeneric(doc.body);
  },
};
