import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { canonicalPostingUrl, DIRECT_API_HOSTS, htmlToText, planLink, postingText, readDirectPosting, scriptOnlyMessage, unwrapRedirect, type LinkPlan } from "./sources";

// All postings here are made up (Brightloop is a fictional company).
const BODY = "We are hiring a software engineer to build tools for teams. You will write code, review designs and ship features. ".repeat(4);

const ok = (data: unknown) => ({ ok: true, status: 200, json: async () => data });
const status = (code: number) => ({ ok: false, status: code, json: async () => ({}) });
type Direct = Extract<LinkPlan, { kind: "direct" }>;
const direct = (u: string) => planLink(u) as Direct;

describe("planLink", () => {
  it("recognizes Greenhouse board, job-boards and embed links", () => {
    expect(planLink("https://boards.greenhouse.io/brightloop/jobs/4012345")).toMatchObject({ kind: "direct", source: "greenhouse", org: "brightloop", id: "4012345" });
    expect(planLink("https://job-boards.greenhouse.io/brightloop/jobs/4012345?gh_src=abc")).toMatchObject({ kind: "direct", org: "brightloop", id: "4012345" });
    expect(planLink("https://boards.greenhouse.io/embed/job_app?for=brightloop&token=4012345")).toMatchObject({ kind: "direct", org: "brightloop", id: "4012345" });
    expect(planLink("https://boards.greenhouse.io/brightloop?gh_jid=4012345")).toMatchObject({ kind: "direct", id: "4012345" });
  });

  it("recognizes Lever links with or without /apply, and the EU host", () => {
    const id = "223f9722-3579-4ff2-b123-e4cc7b0c1a64";
    expect(planLink(`https://jobs.lever.co/brightloop/${id}`)).toMatchObject({ kind: "direct", source: "lever", org: "brightloop", id });
    expect(planLink(`https://jobs.lever.co/brightloop/${id}/apply?lever-source=x`)).toMatchObject({ kind: "direct", id });
    expect(planLink(`https://jobs.eu.lever.co/brightloop/${id}`)).toMatchObject({ kind: "direct", eu: true });
  });

  it("recognizes Ashby and SmartRecruiters links", () => {
    const id = "7458d4e9-da2e-47bd-98cb-adfda43d42b2";
    expect(planLink(`https://jobs.ashbyhq.com/brightloop/${id}/application`)).toMatchObject({ kind: "direct", source: "ashby", org: "brightloop", id });
    expect(planLink("https://jobs.smartrecruiters.com/BrightLoop/744000156179239-application-engineer")).toMatchObject({
      kind: "direct",
      source: "smartrecruiters",
      org: "BrightLoop",
      id: "744000156179239",
    });
  });

  it("sends other company pages to the AI reader, including a company page with gh_jid", () => {
    expect(planLink("https://brightloop.example/careers/engineer?gh_jid=4012345")).toMatchObject({ kind: "fetch" });
    expect(planLink("https://brightloop.example/careers/engineer")).toMatchObject({ kind: "fetch" });
  });

  it("refuses LinkedIn, Indeed, Glassdoor and Jobright without fetching, pointing to the company page", () => {
    for (const u of [
      "https://www.linkedin.com/jobs/view/3912345678",
      "https://www.indeed.com/viewjob?jk=abc123",
      "https://www.glassdoor.com/job-listing/x.htm?jl=1",
      "https://jobright.ai/jobs/info/abc",
      "https://lnkd.in/abcd",
    ]) {
      const plan = planLink(u);
      expect(plan.kind).toBe("paste");
      expect((plan as { message: string }).message).toMatch(/paste the description/i);
    }
    expect((planLink("https://www.linkedin.com/jobs/view/1") as { message: string }).message).toMatch(/company's own careers page/);
  });

  it("marks Workday and Apple as script-only but still readable by the posting reader", () => {
    expect(planLink("https://brightloop.wd5.myworkdayjobs.com/en-US/Careers/job/Remote/Engineer_R1")).toMatchObject({ kind: "fetch", scriptOnly: "Workday" });
    expect(planLink("https://jobs.apple.com/en-us/details/200000000/software-engineer")).toMatchObject({ kind: "fetch", scriptOnly: "Apple" });
    expect(planLink("https://brightloop.example/careers/1")).not.toHaveProperty("scriptOnly");
    expect(scriptOnlyMessage("Workday")).toBe("Workday pages load with JavaScript, so the app can't read them. Paste the description instead.");
  });

  it("rejects text that is not a link", () => {
    expect(planLink("not a link at all ::")).toMatchObject({ kind: "invalid" });
    expect(planLink("ftp://x.example/job")).toMatchObject({ kind: "invalid" });
  });

  it("looks through a wrapper link to the real posting (and the board it points to)", () => {
    const real = "https://boards.greenhouse.io/brightloop/jobs/4012345";
    expect(planLink(`https://www.google.com/url?q=${encodeURIComponent(real)}&sa=D`)).toMatchObject({ kind: "direct", id: "4012345" });
    expect(planLink(`https://www.linkedin.com/safety/go?url=${encodeURIComponent(real)}`)).toMatchObject({ kind: "direct", id: "4012345" });
    expect(planLink(`https://l.facebook.com/l.php?u=${encodeURIComponent("https://www.indeed.com/viewjob?jk=1")}`)).toMatchObject({ kind: "paste", site: "Indeed" });
  });
});

describe("unwrapRedirect and canonical links", () => {
  it("leaves ordinary links alone and ignores wrappers without an http target", () => {
    expect(unwrapRedirect("https://brightloop.example/jobs/1")).toBe("https://brightloop.example/jobs/1");
    expect(unwrapRedirect("https://www.google.com/url?q=javascript:alert(1)")).toBe("https://www.google.com/url?q=javascript:alert(1)");
  });

  it("makes the apply, embed and board-host variants of one posting identical", () => {
    const id = "223f9722-3579-4ff2-b123-e4cc7b0c1a64";
    expect(canonicalPostingUrl(`https://jobs.lever.co/Brightloop/${id}/apply`)).toBe(canonicalPostingUrl(`https://jobs.lever.co/brightloop/${id}?lever-source=li`));
    expect(canonicalPostingUrl("https://boards.greenhouse.io/embed/job_app?for=brightloop&token=1234567")).toBe(
      canonicalPostingUrl("https://job-boards.greenhouse.io/brightloop/jobs/1234567"),
    );
    expect(canonicalPostingUrl("https://brightloop.example/careers")).toBe("");
  });
});

describe("htmlToText", () => {
  it("decodes escaped HTML (Greenhouse), keeps list items and drops scripts", () => {
    const html = "&lt;h2&gt;About&lt;/h2&gt;&lt;p&gt;Build &amp;amp; ship&lt;/p&gt;&lt;ul&gt;&lt;li&gt;Python&lt;/li&gt;&lt;li&gt;SQL&lt;/li&gt;&lt;/ul&gt;";
    expect(htmlToText(html)).toContain("- Python\n- SQL");
    expect(htmlToText("<p>a</p><script>alert(1)</script><p>b &nbsp;&#169; &#x41;</p>")).toBe("a\nb © A");
  });
});

describe("postingText", () => {
  it("builds text from each ATS's shape", () => {
    expect(postingText("greenhouse", { title: "Engineer", company_name: "Brightloop", location: { name: "Remote" }, content: "&lt;p&gt;Do things&lt;/p&gt;" })).toBe(
      "Engineer\nBrightloop\nRemote\n\nDo things",
    );
    const lever = postingText("lever", {
      text: "Engineer",
      categories: { location: "Austin" },
      descriptionPlain: "Intro text",
      lists: [{ text: "Requirements", content: "<li>Python</li>" }],
      additionalPlain: "EEO statement",
    });
    expect(lever).toContain("Requirements\n- Python");
    expect(lever).toContain("EEO statement");
    expect(postingText("ashby", { title: "Engineer", location: "Austin", isRemote: true, descriptionPlain: "Body" })).toBe("Engineer\nAustin\nRemote\n\nBody");
    const sr = postingText("smartrecruiters", {
      name: "Engineer",
      company: { name: "Brightloop" },
      jobAd: { sections: { jobDescription: { title: "Job Description", text: "<p>Build</p>" }, qualifications: { title: "Qualifications", text: "<p>Degree</p>" } } },
    });
    expect(sr).toContain("Job Description\nBuild");
    expect(sr).toContain("Qualifications\nDegree");
  });

  it("copes with missing fields", () => {
    expect(postingText("greenhouse", {})).toBe("");
    expect(postingText("lever", null)).toBe("");
  });
});

describe("readDirectPosting", () => {
  const gh = direct("https://boards.greenhouse.io/brightloop/jobs/4012345");

  it("reads Greenhouse from boards-api with no AI", async () => {
    const f = vi.fn(async (_u: string) => ok({ title: "Engineer", company_name: "Brightloop", location: { name: "Remote" }, content: `&lt;p&gt;${BODY}&lt;/p&gt;` }));
    const out = await readDirectPosting(gh, f);
    expect(f.mock.calls[0][0]).toBe("https://boards-api.greenhouse.io/v1/boards/brightloop/jobs/4012345");
    expect(out?.text).toContain("We are hiring a software engineer");
  });

  it("reads Lever (and the EU data center) by posting id", async () => {
    const id = "223f9722-3579-4ff2-b123-e4cc7b0c1a64";
    const f = vi.fn(async (_u: string) => ok({ text: "Engineer", descriptionPlain: BODY }));
    await readDirectPosting(direct(`https://jobs.lever.co/brightloop/${id}`), f);
    expect(f.mock.calls[0][0]).toBe(`https://api.lever.co/v0/postings/brightloop/${id}`);
    await readDirectPosting(direct(`https://jobs.eu.lever.co/brightloop/${id}`), f);
    expect(f.mock.calls[1][0]).toBe(`https://api.eu.lever.co/v0/postings/brightloop/${id}`);
  });

  it("finds the posting inside Ashby's board listing", async () => {
    const id = "7458d4e9-da2e-47bd-98cb-adfda43d42b2";
    const f = vi.fn(async () => ok({ jobs: [{ id: "other", title: "X", descriptionPlain: BODY }, { id, title: "Engineer", descriptionPlain: BODY }] }));
    const out = await readDirectPosting(direct(`https://jobs.ashbyhq.com/brightloop/${id}`), f);
    expect(out?.text.startsWith("Engineer")).toBe(true);
  });

  it("says an Ashby posting missing from the board is probably closed", async () => {
    const id = "7458d4e9-da2e-47bd-98cb-adfda43d42b2";
    const f = async () => ok({ jobs: [{ id: "someone-else", title: "X", descriptionPlain: BODY }] });
    await expect(readDirectPosting(direct(`https://jobs.ashbyhq.com/brightloop/${id}`), f)).rejects.toThrow(/Ashby says this posting is no longer listed/);
  });

  it("reads SmartRecruiters by company and numeric id", async () => {
    const f = vi.fn(async (_u: string) => ok({ name: "Engineer", jobAd: { sections: { jobDescription: { title: "Description", text: `<p>${BODY}</p>` } } } }));
    const out = await readDirectPosting(direct("https://jobs.smartrecruiters.com/BrightLoop/744000156179239-engineer"), f);
    expect(f.mock.calls[0][0]).toBe("https://api.smartrecruiters.com/v1/companies/BrightLoop/postings/744000156179239");
    expect(out?.source).toBe("smartrecruiters");
  });

  it("a 404 means the posting is closed: an explanation, not a fall-through", async () => {
    await expect(readDirectPosting(gh, async () => status(404))).rejects.toMatchObject({
      kind: "fetch_failed",
      message: expect.stringMatching(/no longer listed.*paste the description/),
    });
  });

  it("returns null (so the next reader tries) on a network error, a server error, bad JSON or a stub", async () => {
    expect(await readDirectPosting(gh, async () => { throw new TypeError("Failed to fetch"); })).toBeNull();
    expect(await readDirectPosting(gh, async () => status(500))).toBeNull();
    expect(await readDirectPosting(gh, async () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError("bad"); } }))).toBeNull();
    expect(await readDirectPosting(gh, async () => ok({ title: "Engineer", content: "Short." }))).toBeNull();
    expect(await readDirectPosting(gh, async () => ok("a string"))).toBeNull();
  });

  it("never sends credentials or custom headers", async () => {
    const f = vi.fn(async (_u: string, _i?: unknown) => ok({ title: "T", content: BODY }));
    await readDirectPosting(gh, f);
    expect(f.mock.calls[0][1]).not.toHaveProperty("credentials");
    expect(f.mock.calls[0][1]).not.toHaveProperty("headers");
  });
});

describe("CSP", () => {
  it("lists every direct API host in connect-src, and no Workday or LinkedIn host", () => {
    const config = readFileSync(new URL("../../next.config.js", import.meta.url), "utf8");
    for (const host of DIRECT_API_HOSTS) expect(config).toContain(`"${host}"`);
    expect(config).not.toMatch(/myworkdayjobs|"https:\/\/[^"]*linkedin/);
  });
});
