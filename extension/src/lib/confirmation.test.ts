import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { isConfirmationPage } from "./confirmation";

const load = (name: string) => {
  document.documentElement.innerHTML = readFileSync(join(__dirname, "__fixtures__", `${name}.html`), "utf8");
};
const body = (html: string) => {
  document.documentElement.innerHTML = `<head></head><body>${html}</body>`;
};

describe("isConfirmationPage", () => {
  it("recognizes a thank-you page with no form left", () => {
    load("greenhouse-confirmation");
    expect(isConfirmationPage(document, { pathname: "/brightloop/jobs/4012345/confirmation" })).toBe(true);
    expect(isConfirmationPage(document)).toBe(true);
  });
  it.each([
    ["Lever", `<h1>Application submitted!</h1><p>Thanks for applying to Brightloop.</p>`],
    ["Ashby", `<div role="alert">Your application was successfully submitted.</div>`],
    ["Workday", `<h2 data-automation-id="applicationSubmitted">Application Submitted</h2><p>We have received your application.</p>`],
    ["plain", `<main><h1>All done</h1><p>We've received your application and will review it.</p></main>`],
  ])("recognizes %s wording", (_n, html) => {
    body(html);
    expect(isConfirmationPage(document)).toBe(true);
  });
  it("does not fire on a job description that says thank you for your interest", () => {
    load("job-description");
    expect(isConfirmationPage(document)).toBe(false);
  });
  it("does not fire on the application form, even if a banner mentions applications", () => {
    load("greenhouse");
    expect(isConfirmationPage(document)).toBe(false);
    body(`<h1>Thanks for applying?</h1><p>Not yet. Fill in the form.</p><input type="text" />`);
    expect(isConfirmationPage(document)).toBe(false);
  });
  it("needs wording as well as a confirmation-looking address", () => {
    body(`<h1>Welcome</h1><p>Browse our roles.</p>`);
    expect(isConfirmationPage(document, { pathname: "/success" })).toBe(false);
    body(`<h1>Thanks</h1><p>Your submission is confirmed.</p>`);
    expect(isConfirmationPage(document, { pathname: "/success" })).toBe(true);
  });
  it("ignores hidden text boxes and hidden messages", () => {
    body(`<h1>Thank you for applying</h1><input type="hidden" /><input type="text" hidden />`);
    expect(isConfirmationPage(document)).toBe(true);
    body(`<div hidden><h1>Thank you for applying</h1></div><p>Loading</p>`);
    expect(isConfirmationPage(document)).toBe(false);
  });
});
