import type { AtsAdapter } from "./types";
import { findResumeInputGeneric } from "./resumeInput";

// Same caveat as greenhouse.ts: hostname match is solid, the CSS selectors are a best guess from
// Lever's long-standing public markup and should be confirmed against a live application form.
export const leverAdapter: AtsAdapter = {
  name: "lever",
  matches: (location) => /(^|\.)lever\.co$/i.test(location.hostname),
  findFormRoot(doc) {
    return doc.querySelector("form.application-form, .application-form") ?? doc.querySelector("form") ?? doc.body;
  },
  findResumeInput(doc) {
    const byName = doc.querySelector<HTMLInputElement>('input[name="resume"], input[name*="resume" i]');
    return byName ?? findResumeInputGeneric(doc.body);
  },
};
