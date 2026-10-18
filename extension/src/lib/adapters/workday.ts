import type { AtsAdapter } from "./types";
import { findResumeInputGeneric } from "./resumeInput";
import { workdayJobInfo } from "../pageJob";

// Workday tenants live on <tenant>.wdN.myworkdayjobs.com and apply in several steps (sign in,
// My Information, My Experience, questions, review). Fields are found by their labels, like every
// other ATS here; markup details (data-automation-id) are only used for the repeated work and
// education blocks and for spotting account pages (guards.ts). Not verified against a live tenant.
export const workdayAdapter: AtsAdapter = {
  name: "workday",
  matches: (location) => /(^|\.)(myworkdayjobs\.com|myworkdaysite\.com)$/i.test(location.hostname),
  findFormRoot(doc) {
    return doc.querySelector('[data-automation-id="applyFlowPage"], [data-automation-id^="applyFlow"]') ?? doc.body;
  },
  findResumeInput(doc) {
    return findResumeInputGeneric(doc.body);
  },
  pageJobInfo: (doc, hostname) => workdayJobInfo(doc, hostname ?? doc.location?.hostname ?? ""),
};
