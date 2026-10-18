import { describe, expect, it } from "vitest";
import { jobIdTokens, matchJob, normalizeJobUrl, postingKey } from "./jobMatch";
import type { SyncedJob } from "../types";

const job = (id: number, company: string, role: string, url: string): SyncedJob => ({ id, company, role, url, stage: "Saved" });

describe("normalizeJobUrl / postingKey", () => {
  it("drops tracking params, www, fragment and trailing slash", () => {
    expect(normalizeJobUrl("https://www.Example.com/jobs/1/?utm_source=x&gh_src=y#apply")).toBe("example.com/jobs/1");
  });
  it("strips the ATS apply step so the form page equals the posting link", () => {
    expect(postingKey("https://jobs.lever.co/taskwise/0a1b2c3d-0000-4000-8000-123456789abc/apply")).toBe("jobs.lever.co/taskwise/0a1b2c3d-0000-4000-8000-123456789abc");
    expect(postingKey("https://jobs.ashbyhq.com/brightloop/0a1b2c3d-0000-4000-8000-123456789abc/application")).toBe("jobs.ashbyhq.com/brightloop/0a1b2c3d-0000-4000-8000-123456789abc");
    expect(postingKey("not a url ::")).toBe("");
  });
});

describe("jobIdTokens", () => {
  it("finds Greenhouse, UUID and Workday ids", () => {
    expect(jobIdTokens("https://boards.greenhouse.io/taskwise/jobs/4012345")).toEqual(["gh:4012345"]);
    expect(jobIdTokens("https://careers.example.com/open?gh_jid=4012345")).toEqual(["gh:4012345"]);
    expect(jobIdTokens("https://taskwise.wd5.myworkdayjobs.com/en-US/Careers/job/Remote/Software-Engineer_R-10234/apply")).toEqual(["req:taskwise:R10234"]);
  });
});

describe("matchJob", () => {
  const jobs = [
    job(1, "Taskwise", "Software Engineer", "https://boards.greenhouse.io/taskwise/jobs/4012345?gh_src=abc"),
    job(2, "Brightloop", "Backend Engineer", "https://jobs.lever.co/brightloop/0a1b2c3d-0000-4000-8000-123456789abc"),
    job(3, "DemoDeck", "Frontend Engineer", ""),
    job(4, "DemoDeck", "Backend Engineer", ""),
  ];
  it("matches by link, including the apply step", () => {
    expect(matchJob(jobs, "https://jobs.lever.co/brightloop/0a1b2c3d-0000-4000-8000-123456789abc/apply", { company: "", role: "" })).toMatchObject({ by: "link", job: { id: 2 } });
  });
  it("matches by ATS job id when the host differs from the saved link", () => {
    expect(matchJob(jobs, "https://job-boards.greenhouse.io/taskwise/jobs/4012345", { company: "", role: "" })).toMatchObject({ by: "id", job: { id: 1 } });
  });
  it("matches by company and role for jobs saved without a link", () => {
    expect(matchJob(jobs, "https://careers.demodeck.example/apply", { company: "DemoDeck Inc.", role: "Frontend Engineer" })).toMatchObject({ by: "title", job: { id: 3 } });
  });
  it("never guesses between two jobs at one company", () => {
    expect(matchJob(jobs, "https://x.example/a", { company: "DemoDeck", role: "Engineer" })).toBeNull();
  });
  it("returns null for an unknown page", () => {
    expect(matchJob(jobs, "https://x.example/a", { company: "Other Co", role: "Designer" })).toBeNull();
  });
});
