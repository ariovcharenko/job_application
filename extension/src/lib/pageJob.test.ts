import { describe, expect, it } from "vitest";
import { ashbyJobInfo, genericJobInfo, greenhouseJobInfo, leverJobInfo, splitCompanyDashRole, splitRoleAtCompany, workdayJobInfo } from "./pageJob";

const parse = (html: string) => new DOMParser().parseFromString(html, "text/html");

describe("pageJob", () => {
  it("prefers the JobPosting JSON-LD on any ATS", () => {
    const doc = parse(`<head><title>whatever</title><script type="application/ld+json">{"@context":"https://schema.org","@type":"JobPosting","title":"Software Engineer, New Grad","hiringOrganization":{"@type":"Organization","name":"Taskwise"}}</script></head><body></body>`);
    for (const f of [greenhouseJobInfo, leverJobInfo, ashbyJobInfo, genericJobInfo]) expect(f(doc)).toEqual({ company: "Taskwise", role: "Software Engineer, New Grad" });
  });
  it("reads a Greenhouse page from its markup, then its title", () => {
    expect(greenhouseJobInfo(parse(`<body><h1 class="app-title">Backend Engineer</h1><span class="company-name">at Brightloop</span></body>`))).toEqual({ role: "Backend Engineer", company: "Brightloop" });
    expect(greenhouseJobInfo(parse(`<head><title>Job Application for Backend Engineer at Brightloop</title></head><body></body>`))).toEqual({ role: "Backend Engineer", company: "Brightloop" });
  });
  it("reads Lever's 'Company - Role' title and headline", () => {
    expect(leverJobInfo(parse(`<head><title>Brightloop - Backend Engineer</title></head><body><div class="posting-headline"><h2>Backend Engineer</h2></div></body>`))).toEqual({ company: "Brightloop", role: "Backend Engineer" });
  });
  it("reads Ashby's 'Role @ Company' title", () => {
    expect(ashbyJobInfo(parse(`<head><title>Backend Engineer @ Brightloop</title></head><body></body>`))).toEqual({ role: "Backend Engineer", company: "Brightloop" });
  });
  it("reads Workday's header and tenant", () => {
    expect(workdayJobInfo(parse(`<body><h2 data-automation-id="jobPostingHeader">Backend Engineer</h2></body>`), "brightloop.wd5.myworkdayjobs.com")).toEqual({ role: "Backend Engineer", company: "brightloop" });
  });
  it("splits titles both ways and survives garbage JSON-LD", () => {
    expect(splitRoleAtCompany("Designer at DemoDeck")).toEqual({ role: "Designer", company: "DemoDeck" });
    expect(splitCompanyDashRole("DemoDeck | Designer")).toEqual({ company: "DemoDeck", role: "Designer" });
    expect(genericJobInfo(parse(`<head><script type="application/ld+json">{bad</script></head><body><h1>Designer</h1></body>`)).role).toBe("Designer");
  });
});
