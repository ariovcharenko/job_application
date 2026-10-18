import { describe, expect, it } from "vitest";
import { isBlockedHost, isKnownAtsHost, originPatternFor } from "./hosts";

describe("hosts", () => {
  it("blocks LinkedIn, Indeed (any country) and Jobright, including subdomains", () => {
    for (const h of ["linkedin.com", "www.linkedin.com", "uk.indeed.com", "indeed.co.uk", "jobright.ai", "app.jobright.ai"]) expect(isBlockedHost(h), h).toBe(true);
    for (const h of ["boards.greenhouse.io", "notlinkedin.com.example.org", "indeedish.example.com"]) expect(isBlockedHost(h), h).toBe(false);
  });
  it("recognizes the known ATS hosts", () => {
    for (const h of ["job-boards.greenhouse.io", "jobs.lever.co", "jobs.ashbyhq.com", "acme.wd5.myworkdayjobs.com"]) expect(isKnownAtsHost(h), h).toBe(true);
    expect(isKnownAtsHost("example.com")).toBe(false);
  });
  it("asks for one origin only, never a wildcard, and refuses blocked and non-web pages", () => {
    expect(originPatternFor("https://careers.example.com/jobs/1?x=2")).toBe("https://careers.example.com/*");
    expect(originPatternFor("https://www.linkedin.com/jobs/view/1")).toBeNull();
    expect(originPatternFor("chrome://extensions")).toBeNull();
    expect(originPatternFor("not a url")).toBeNull();
  });
});
