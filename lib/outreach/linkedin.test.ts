import { describe, expect, it } from "vitest";
import { alumniSearchUrl, buildOutreachSearches, hiringManagerSearchUrl, recruiterSearchUrl, universityRecruiterSearchUrl } from "./linkedin";

describe("linkedin search url builders", () => {
  it("builds a recruiter search with the company name", () => {
    const url = new URL(recruiterSearchUrl("Stripe"));
    expect(url.origin + url.pathname).toBe("https://www.linkedin.com/search/results/people/");
    expect(url.searchParams.get("keywords")).toContain("Stripe");
  });

  it("includes the school in a university recruiter search when given", () => {
    const url = new URL(universityRecruiterSearchUrl("Stripe", "Lakeside University"));
    expect(url.searchParams.get("keywords")).toContain("Lakeside University");
  });

  it("omits an empty school without leaving stray whitespace", () => {
    const url = new URL(universityRecruiterSearchUrl("Stripe", ""));
    expect(url.searchParams.get("keywords")).toBe("Stripe university recruiter");
  });

  it("combines company and role title for a hiring manager search", () => {
    const url = new URL(hiringManagerSearchUrl("Stripe", "Software Engineer"));
    const kw = url.searchParams.get("keywords") ?? "";
    expect(kw).toContain("Stripe");
    expect(kw).toContain("Software Engineer");
  });

  it("skips the alumni search entirely when no school is set", () => {
    const searches = buildOutreachSearches("Stripe", "SWE", "");
    expect(searches.some((s) => s.type === "alumni")).toBe(false);
  });

  it("includes an alumni search when a school is set", () => {
    const searches = buildOutreachSearches("Stripe", "SWE", "Lakeside University");
    const alumni = searches.find((s) => s.type === "alumni");
    expect(alumni).toBeDefined();
    expect(new URL(alumni!.url).searchParams.get("keywords")).toBe("Stripe Lakeside University");
    expect(alumni!.url).toBe(alumniSearchUrl("Stripe", "Lakeside University"));
  });
});
