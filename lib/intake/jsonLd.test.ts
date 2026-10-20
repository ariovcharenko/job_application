import { describe, expect, it } from "vitest";
import { closedSignal, extractJobPosting, postingToText, visibleText } from "./jsonLd";

// Every page below is made up (a fictional company, "Brightloop"), shaped like what each platform serves.
const DESC_HTML = "<p>Brightloop builds scheduling tools.</p><h3>Responsibilities</h3><ul><li>Build services in Python</li><li>Review designs &amp; code</li></ul><p>Qualifications: a bachelor&#39;s degree.</p>";

const ld = (json: unknown, raw?: string) => `<script type="application/ld+json">${raw ?? JSON.stringify(json)}</script>`;
const page = (head: string, body = "<p>Loading</p>") => `<!doctype html><html><head><title>x</title>${head}</head><body>${body}</body></html>`;

const posting = {
  "@context": "http://schema.org",
  "@type": "JobPosting",
  title: "Software Engineer I",
  description: DESC_HTML,
  datePosted: "2026-10-01",
  validThrough: "2026-12-01T00:00",
  employmentType: "FULL_TIME",
  hiringOrganization: { "@type": "Organization", name: "Brightloop Labs" },
  identifier: { "@type": "PropertyValue", name: "Brightloop", value: "R-1234" },
  jobLocation: { "@type": "Place", address: { "@type": "PostalAddress", addressLocality: "Springfield", addressRegion: "IL", addressCountry: "US" } },
};

describe("extractJobPosting", () => {
  it("reads a Phenom-style page: one script, shell body, escaped description", () => {
    const html = page(ld({ ...posting, description: DESC_HTML.replace(/</g, "&lt;").replace(/>/g, "&gt;") }));
    const p = extractJobPosting(html)!;
    expect(p.title).toBe("Software Engineer I");
    expect(p.company).toBe("Brightloop Labs");
    expect(p.locations).toEqual(["Springfield, IL, US"]);
    expect(p.employmentType).toBe("Full time");
    expect(p.datePosted).toBe("2026-10-01");
    expect(p.validThrough).toBe("2026-12-01T00:00");
    expect(p.identifier).toBe("R-1234");
    expect(p.descriptionText).toContain("Build services in Python");
    expect(p.descriptionText).toContain("Review designs & code");
    expect(p.descriptionText).toContain("bachelor's degree");
    expect(p.descriptionText).not.toMatch(/<|&lt;|&amp;/);
  });

  it("reads a Workday-style page: several locations, remote type, salary, array employment type", () => {
    const p = extractJobPosting(
      page(
        ld({
          ...posting,
          jobLocation: [
            { "@type": "Place", address: { addressLocality: "Austin", addressRegion: "TX", addressCountry: { "@type": "Country", name: "United States" } } },
            { "@type": "Place", address: "Denver, CO" },
          ],
          jobLocationType: "TELECOMMUTE",
          employmentType: ["FULL_TIME", "CONTRACTOR"],
          baseSalary: { "@type": "MonetaryAmount", currency: "USD", value: { "@type": "QuantitativeValue", minValue: 90000, maxValue: 120000, unitText: "YEAR" } },
        }),
      ),
    )!;
    expect(p.locations).toEqual(["Remote", "Austin, TX, United States", "Denver, CO"]);
    expect(p.employmentType).toBe("Full time, Contractor");
    expect(p.salary).toBe("USD 90,000 to 120,000 per year");
  });

  it("reads an iCIMS-style page: @graph with other types and @type as an array", () => {
    const html = page(ld({ "@context": "https://schema.org", "@graph": [{ "@type": "WebSite", name: "Careers" }, { ...posting, "@type": ["Thing", "JobPosting"] }] }));
    expect(extractJobPosting(html)?.title).toBe("Software Engineer I");
  });

  it("reads a SuccessFactors-style page: a top-level array, a second unrelated block, one invalid block", () => {
    const html = page(
      ld(null, "{ not json at all") + ld({ "@type": "BreadcrumbList", itemListElement: [] }) + ld([{ "@type": "Organization", name: "Brightloop" }, posting]),
    );
    expect(extractJobPosting(html)?.company).toBe("Brightloop Labs");
  });

  it("accepts a full type URL, single-quoted attributes, CDATA wrapping and raw line breaks inside strings", () => {
    const body = JSON.stringify({ ...posting, "@type": "http://schema.org/JobPosting", title: "PLACEHOLDER" }).replace("PLACEHOLDER", "Data\nEngineer");
    const html = `<script type='application/ld+json'>//<![CDATA[\n${body}\n//]]></script>`;
    expect(extractJobPosting(html)?.title).toBe("Data Engineer");
  });

  it("takes the posting with the longest description when a page has two", () => {
    const html = page(ld({ ...posting, title: "Short", description: "<p>tiny</p>" }) + ld({ ...posting, title: "Long" }));
    expect(extractJobPosting(html)?.title).toBe("Long");
  });

  it("falls back to microdata", () => {
    const html = page(
      "",
      `<div itemscope itemtype="http://schema.org/JobPosting"><h1 itemprop="title">Support Engineer</h1>
       <div itemprop="hiringOrganization" itemscope itemtype="http://schema.org/Organization"><span itemprop="name">Taskwise</span></div>
       <meta itemprop="datePosted" content="2026-09-30"><div itemprop="jobLocation" itemscope><span itemprop="addressLocality">Boise</span>, <span itemprop="addressRegion">ID</span></div>
       <div itemprop="description"><p>Help customers.</p><ul><li>Debug issues</li></ul></div></div>`,
    );
    const p = extractJobPosting(html)!;
    expect(p).toMatchObject({ title: "Support Engineer", company: "Taskwise", datePosted: "2026-09-30", locations: ["Boise, ID"] });
    expect(p.descriptionText).toContain("Debug issues");
  });

  it("returns null with no posting, or with only invalid or unrelated blocks", () => {
    expect(extractJobPosting(page("", "<p>hello</p>"))).toBeNull();
    expect(extractJobPosting(page(ld(null, "{broken") + ld({ "@type": "Organization", name: "x" })))).toBeNull();
    expect(extractJobPosting("")).toBeNull();
  });

  it("never returns markup", () => {
    // A literal "</script>" would end the JSON block in a browser too, so a page writes it as "<\/script>".
    const raw = JSON.stringify({ ...posting, description: "<p>Hi</p><script>alert(1)</script><img src=x onerror=alert(1)>text" }).replace(/<\/script>/g, "<\\/script>");
    const p = extractJobPosting(page(ld(null, raw)))!;
    expect(p.descriptionText).toBe("Hi\ntext");
  });
});

describe("closedSignal", () => {
  it("detects the usual wordings", () => {
    for (const t of [
      "Sorry, this job is no longer available.",
      "The job you are looking for has been filled.",
      "This position has been filled",
      "This position is closed.",
      "This job has expired",
      "We are no longer accepting applications for this role",
      "Applications for this job are now closed",
      "The posting has been removed",
    ]) {
      expect(closedSignal(t), t).toBe(true);
    }
  });
  it("does not fire on ordinary posting text", () => {
    for (const t of ["You will be filled with curiosity and build great tools.", "Our offices are closed on holidays.", "Responsibilities: close tickets and fill gaps in tests.", "This job posting will remain open until the position is filled.", "We review applications until the role is filled or closed.", "Apply early: the posting may close when the position is filled."]) {
      expect(closedSignal(t), t).toBe(false);
    }
  });
  it("works on the visible text of a page, ignoring scripts", () => {
    const html = page(ld(posting) + "<style>.a{}</style>", "<div><h2>Oops</h2><p>This job has been filled.</p></div><footer>Privacy</footer>");
    const visible = visibleText(html);
    expect(visible).toContain("This job has been filled");
    expect(visible).not.toContain("Brightloop builds");
    expect(closedSignal(visible)).toBe(true);
  });
});

describe("postingToText", () => {
  it("builds heading lines then the description", () => {
    const p = extractJobPosting(page(ld(posting)))!;
    const text = postingToText(p);
    expect(text.split("\n").slice(0, 5)).toEqual(["Software Engineer I", "Brightloop Labs", "Location: Springfield, IL, US", "Employment type: Full time", "Posted: 2026-10-01"]);
    expect(text).toContain("\n\nBrightloop builds scheduling tools.");
  });
});
