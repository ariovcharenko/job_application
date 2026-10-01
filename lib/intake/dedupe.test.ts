import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../db";
import { blankApplication } from "../tracker/blank";
import { applyStageChange } from "../tracker/stage";
import { skipJob, trackJob, isTracked } from "../tracker/triage";
import type { Application } from "../types";
import { findExistingJob, findMatch, normalizeJobUrl, sameCompanyAndRole } from "./dedupe";

const job = (o: Partial<Application>): Application & { id: number } => ({ ...blankApplication(), id: 1, ...o }) as Application & { id: number };

describe("normalizeJobUrl", () => {
  it("treats the same posting shared from different places as one link", () => {
    const a = normalizeJobUrl("https://job-boards.greenhouse.io/ziprecruiter/jobs/8127108?utm_source=linkedin&gh_src=abc");
    expect(a).toBe("job-boards.greenhouse.io/ziprecruiter/jobs/8127108");
    expect(normalizeJobUrl("https://WWW.job-boards.greenhouse.io/ziprecruiter/jobs/8127108/#apply")).toBe(a);
    expect(normalizeJobUrl("job-boards.greenhouse.io/ziprecruiter/jobs/8127108")).toBe(a);
  });
  it("keeps parameters that identify the job", () => {
    expect(normalizeJobUrl("https://acme.com/careers?gh_jid=123&utm_medium=x")).toBe("acme.com/careers?gh_jid=123");
    expect(normalizeJobUrl("https://acme.com/careers?gh_jid=123")).not.toBe(normalizeJobUrl("https://acme.com/careers?gh_jid=456"));
  });
  it("returns empty for non-links", () => {
    expect(normalizeJobUrl("")).toBe("");
    expect(normalizeJobUrl("not a link at all")).toBe("");
  });
});

describe("findMatch", () => {
  const apps = [
    job({ id: 1, company: "ZipRecruiter", role: "Software Engineer - New Grad", url: "https://job-boards.greenhouse.io/ziprecruiter/jobs/8127108" }),
    job({ id: 2, company: "Apple", role: "Software Engineer, Watch Software", url: "" }),
  ];
  it("finds the same position by link, then by company and role", () => {
    expect(findMatch(apps, { url: "https://job-boards.greenhouse.io/ziprecruiter/jobs/8127108?utm_source=x" })?.id).toBe(1);
    expect(findMatch(apps, { company: "apple", role: "Software Engineer - Watch Software" })?.id).toBe(2);
    expect(findMatch(apps, { company: "Apple", role: "Hardware Engineer" })).toBeUndefined();
    // Different link, same title: a different posting, not a match.
    expect(findMatch(apps, { url: "https://job-boards.greenhouse.io/ziprecruiter/jobs/999", company: "ZipRecruiter", role: "Software Engineer - New Grad" })).toBeUndefined();
  });
  it("doesn't match on a company alone", () => {
    expect(sameCompanyAndRole({ company: "Apple", role: "" }, { company: "Apple", role: "" })).toBe(false);
  });
});

describe("triage", () => {
  it("moves a checked job into the table when she applies, and hides a skipped one", () => {
    const checked = job({ triage: "checked" });
    expect(isTracked(checked)).toBe(false);
    expect(isTracked(applyStageChange(checked, "Applied", "2026-09-28"))).toBe(true);
    expect(isTracked(applyStageChange(checked, "Saved", "2026-09-28"))).toBe(false);
    expect(isTracked(trackJob(checked))).toBe(true);
    expect(skipJob(checked).triage).toBe("skipped");
  });
});

describe("findExistingJob", () => {
  beforeEach(async () => {
    await db.applications.clear();
  });
  it("looks through every stored job, including skipped ones", async () => {
    await db.applications.add({ ...blankApplication(), company: "Acme", role: "SWE", url: "https://acme.com/jobs/1", triage: "skipped" });
    expect((await findExistingJob({ url: "https://www.acme.com/jobs/1/" }))?.company).toBe("Acme");
  });
});
