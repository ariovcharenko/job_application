import { describe, expect, it } from "vitest";
import { findMatch, postingKey } from "./dedupe";
import { blankApplication } from "../tracker/blank";

describe("postingKey for job boards", () => {
  it("treats apply, embed and tracking variants of one posting as the same link", () => {
    const id = "223f9722-3579-4ff2-b123-e4cc7b0c1a64";
    expect(postingKey(`https://jobs.lever.co/brightloop/${id}/apply?lever-origin=applied&fbclid=zz`)).toBe(postingKey(`https://jobs.lever.co/brightloop/${id}`));
    expect(postingKey("https://boards.greenhouse.io/embed/job_app?for=brightloop&token=4012345")).toBe(
      postingKey("https://boards.greenhouse.io/brightloop/jobs/4012345?gh_src=x"),
    );
  });

  it("unwraps a redirector before comparing, and ignores click ids", () => {
    const real = "https://brightloop.example/careers/engineer";
    expect(postingKey(`https://www.google.com/url?q=${encodeURIComponent(real)}`)).toBe(postingKey(real));
    expect(postingKey(`${real}?gclid=abc`)).toBe(postingKey(real));
  });

  it("finds a saved job from a differently written link to it", () => {
    const saved = { ...blankApplication(), id: 1, url: "https://boards.greenhouse.io/brightloop/jobs/4012345" };
    expect(findMatch([saved], { url: "https://boards.greenhouse.io/embed/job_app?for=brightloop&token=4012345" })).toBe(saved);
  });
});
