import { afterEach, describe, expect, it, vi } from "vitest";
import { JSearchError, searchJobs } from "./jsearch";

function stubFetch(status: number, body: unknown, headers: Record<string, string> = {}) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } })),
  );
}

afterEach(() => vi.unstubAllGlobals());

describe("searchJobs", () => {
  it("refuses to call out with no key", async () => {
    await expect(searchJobs("", "software engineer")).rejects.toThrow(JSearchError);
  });

  it("sends the documented endpoint, headers and query params", async () => {
    stubFetch(200, { data: { jobs: [], cursor: null } });
    await searchJobs("my-key", "software engineer at Acme");
    const [url, init] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(String(url)).toContain("https://jsearch.p.rapidapi.com/search-v2?");
    expect(String(url)).toContain("query=software+engineer+at+Acme");
    expect((init as RequestInit).headers).toMatchObject({
      "X-RapidAPI-Key": "my-key",
      "X-RapidAPI-Host": "jsearch.p.rapidapi.com",
    });
  });

  it("normalizes a listing, including a remote location and a posted timestamp in ms", async () => {
    stubFetch(200, {
      data: [
        {
          job_id: "abc123",
          job_title: "Software Engineer, New Grad",
          employer_name: "Acme",
          job_apply_link: "https://acme.example/jobs/1",
          job_description: "Join our team...",
          job_is_remote: true,
          job_city: "",
          job_state: "",
          job_country: "US",
          job_posted_at_timestamp: 1_700_000_000,
          job_min_salary: 90000,
          job_max_salary: 110000,
          job_salary_currency: "USD",
        },
      ],
    });
    const { postings } = await searchJobs("k", "swe");
    expect(postings).toEqual([
      {
        source: "jsearch",
        externalId: "abc123",
        url: "https://acme.example/jobs/1",
        company: "Acme",
        title: "Software Engineer, New Grad",
        location: "Remote",
        isRemote: true,
        description: "Join our team...",
        postedAt: 1_700_000_000_000,
        salaryMin: 90000,
        salaryMax: 110000,
        salaryCurrency: "USD",
      },
    ]);
  });

  it("builds a city/state location for a non-remote listing", async () => {
    stubFetch(200, {
      data: [{ job_title: "SWE", employer_name: "Acme", job_is_remote: false, job_city: "Irvine", job_state: "CA" }],
    });
    const { postings } = await searchJobs("k", "swe");
    expect(postings[0].location).toBe("Irvine, CA");
  });

  it("skips a listing with no title and no employer instead of crashing", async () => {
    stubFetch(200, { data: [{ job_description: "..." }, { job_title: "SWE", employer_name: "Acme" }] });
    const { postings } = await searchJobs("k", "swe");
    expect(postings).toHaveLength(1);
  });

  it("reads jobs from the v2 { data: { jobs } } shape", async () => {
    stubFetch(200, {
      status: "OK",
      data: { jobs: [{ job_id: "g1", job_title: "Software Engineer", employer_name: "Google", job_city: "Chicago", job_state: "Illinois" }], cursor: "abc" },
    });
    const { postings } = await searchJobs("k", "q");
    expect(postings).toHaveLength(1);
    expect(postings[0]).toMatchObject({ externalId: "g1", company: "Google", location: "Chicago, Illinois" });
  });

  it("returns no postings rather than crashing when data is missing or malformed", async () => {
    stubFetch(200, { status: "OK", data: { cursor: null } });
    expect((await searchJobs("k", "q")).postings).toEqual([]);
  });

  it("reads the remaining-quota header when present", async () => {
    stubFetch(200, { data: [] }, { "x-ratelimit-requests-remaining": "173" });
    const { requestsRemaining } = await searchJobs("k", "swe");
    expect(requestsRemaining).toBe(173);
  });

  it("gives a plain message for an invalid key, a used-up quota, and a network failure", async () => {
    stubFetch(403, { message: "Invalid key" });
    await expect(searchJobs("bad", "swe")).rejects.toMatchObject({ status: 403 });

    stubFetch(429, {});
    await expect(searchJobs("k", "swe")).rejects.toThrow(/monthly request limit/);

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("network down");
      }),
    );
    await expect(searchJobs("k", "swe")).rejects.toThrow(/Could not reach/);
  });
});
