import { describe, expect, it } from "vitest";
import { normalizeJobUrl as extensionNormalize } from "../../extension/src/lib/jobMatch";
import { normalizeJobUrl } from "./dedupe";

// The Chrome extension keeps its own copy of normalizeJobUrl (it builds as a separate package).
// They must agree, or a page would stop matching the job saved from the same link.
describe("extension normalizeJobUrl matches the app's", () => {
  it.each([
    "https://www.example.com/jobs/1/?utm_source=x&gh_src=y#apply",
    "boards.greenhouse.io/taskwise/jobs/4012345",
    "https://jobs.lever.co/brightloop/0a1b2c3d-0000-4000-8000-123456789abc?lever-source=Linkedin",
    "https://Example.com/Jobs/2?b=2&a=1",
    "not a url ::",
    "",
  ])("%s", (u) => {
    expect(extensionNormalize(u)).toBe(normalizeJobUrl(u));
  });
});
