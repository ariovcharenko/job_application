import type { AtsAdapter } from "./types";
import { findResumeInputGeneric } from "./resumeInput";

// Greenhouse's exact markup has shifted between their older (boards.greenhouse.io) and newer
// (job-boards.greenhouse.io) hosting, so this only relies on the hostname plus a couple of
// long-stable selector guesses, falling back to generic detection if they don't match. Not yet
// verified against a live Greenhouse form — worth confirming on a real posting before relying on it.
export const greenhouseAdapter: AtsAdapter = {
  name: "greenhouse",
  matches: (location) => /(^|\.)greenhouse\.io$/i.test(location.hostname),
  findFormRoot(doc) {
    return doc.querySelector("#application_form, form.application-form, form#application-form") ?? doc.querySelector("form") ?? doc.body;
  },
  findResumeInput(doc) {
    const byId = doc.querySelector<HTMLInputElement>('input#resume, input[name="resume"], input[name*="resume" i]');
    return byId ?? findResumeInputGeneric(doc.body);
  },
};
