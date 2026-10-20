import { describe, expect, it, vi } from "vitest";
import { AIError, type AIProvider } from "../ai/provider";
import { NOT_A_POSTING_MESSAGE, readJobPosting } from "./analyze";
import { ClosedPostingError } from "./sources";

// The fallback chain for a link, with every network and AI call mocked. Postings are made up.
const POSTING = (
  "About the role. Brightloop is hiring a software engineer. Responsibilities: build and ship features, review designs, mentor teammates. " +
  "Qualifications: a bachelor's degree, experience with Python, strong skills in testing. Benefits include health coverage and a salary range. "
).repeat(5);
const SHELL = "Skip to content Menu Careers Sign in Cookie settings Accept all Loading ".repeat(15);

const wait = async () => {};
const provider = (fetchUrl?: AIProvider["fetchUrl"]) => ({ fetchUrl }) as unknown as AIProvider;
const page = (text: string) => ({ url: "u", title: "", text });
const ghOk = async () => ({ ok: true, status: 200, json: async () => ({ title: "Engineer", company_name: "Brightloop", content: `&lt;p&gt;${POSTING}&lt;/p&gt;` }) });
const GH = "https://boards.greenhouse.io/brightloop/jobs/4012345";

describe("readJobPosting chain", () => {
  it("reads a Greenhouse link directly: no AI call at all", async () => {
    const fetchUrl = vi.fn();
    const steps: string[] = [];
    const text = await readJobPosting(provider(fetchUrl), GH, { fetchImpl: ghOk, onStep: (s) => steps.push(s), wait });
    expect(text).toContain("Brightloop is hiring");
    expect(fetchUrl).not.toHaveBeenCalled();
    expect(steps).toEqual(["Reading the posting from Greenhouse..."]);
  });

  it("falls back to Claude when the ATS API is unreachable", async () => {
    const fetchUrl = vi.fn(async (_u: string) => page(POSTING));
    const steps: string[] = [];
    const text = await readJobPosting(provider(fetchUrl), GH, {
      fetchImpl: async () => {
        throw new TypeError("Failed to fetch");
      },
      onStep: (s) => steps.push(s),
      wait,
    });
    expect(text).toContain("Brightloop is hiring");
    expect(fetchUrl).toHaveBeenCalledWith(GH);
    expect(steps).toEqual(["Reading the posting from Greenhouse...", "Reading the posting from the company's page...", "Reading the page with Claude..."]);
  });

  it("a closed posting (ATS 404) stops with an explanation and costs nothing", async () => {
    const fetchUrl = vi.fn();
    await expect(
      readJobPosting(provider(fetchUrl), GH, { fetchImpl: async () => ({ ok: false, status: 404, json: async () => ({}) }), wait }),
    ).rejects.toThrow(/no longer listed/);
    expect(fetchUrl).not.toHaveBeenCalled();
  });

  it("uses Claude for an ordinary company page and sends the unwrapped address", async () => {
    const fetchUrl = vi.fn(async (_u: string) => page(POSTING));
    const wrapped = "https://www.google.com/url?q=" + encodeURIComponent("https://brightloop.example/careers/engineer") + "&sa=D";
    await readJobPosting(provider(fetchUrl), wrapped, { wait });
    expect(fetchUrl).toHaveBeenCalledWith("https://brightloop.example/careers/engineer");
  });

  it("retries once on a transient failure, then succeeds", async () => {
    const fetchUrl = vi
      .fn()
      .mockRejectedValueOnce(new AIError("fetch_failed", "Too many page reads right now.", undefined, true))
      .mockResolvedValueOnce(page(POSTING));
    const steps: string[] = [];
    const sleep = vi.fn(async () => {});
    await readJobPosting(provider(fetchUrl), "https://brightloop.example/careers/engineer", { onStep: (s) => steps.push(s), wait: sleep });
    expect(fetchUrl).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledTimes(1);
    expect(steps).toContain("The page didn't load. Trying once more...");
  });

  it("retries rate limits, overloads and dropped connections but only once", async () => {
    for (const kind of ["rate_limit", "overloaded", "network"] as const) {
      const fetchUrl = vi.fn(async () => {
        throw new AIError(kind, "x");
      });
      await expect(readJobPosting(provider(fetchUrl), "https://brightloop.example/j", { wait })).rejects.toMatchObject({ kind });
      expect(fetchUrl).toHaveBeenCalledTimes(2);
    }
  });

  it("does not retry what would fail again: login pages, bad key, no credit", async () => {
    for (const err of [new AIError("fetch_failed", "That page couldn't be opened"), new AIError("auth", "key"), new AIError("billing", "credit")]) {
      const fetchUrl = vi.fn(async () => {
        throw err;
      });
      await expect(readJobPosting(provider(fetchUrl), "https://brightloop.example/j", { wait })).rejects.toBe(err);
      expect(fetchUrl).toHaveBeenCalledTimes(1);
    }
  });

  it("refuses a JavaScript shell and says to paste", async () => {
    await expect(readJobPosting(provider(async () => page(SHELL)), "https://brightloop.example/j", { wait })).rejects.toThrow(NOT_A_POSTING_MESSAGE);
  });

  it("refuses a partial page (too few words)", async () => {
    const partial = page("Software Engineer. Responsibilities: code. Qualifications: degree. Skills: Python.");
    await expect(readJobPosting(provider(async () => partial), "https://brightloop.example/j", { wait })).rejects.toThrow(/didn't include the job description/);
  });

  it("a PDF posting (the reader can't decode it) says to paste", async () => {
    const fetchUrl = async () => {
      throw new AIError("fetch_failed", "That link is a PDF, which can't be read as a posting yet. Paste the job description instead.");
    };
    await expect(readJobPosting(provider(fetchUrl), "https://brightloop.example/job.pdf", { wait })).rejects.toThrow(/PDF.*Paste/);
  });

  it("LinkedIn, Indeed and Workday: no request of any kind, a reason and what to do", async () => {
    const fetchUrl = vi.fn();
    const fetchImpl = vi.fn();
    const readerImpl = vi.fn();
    const cases: [string, RegExp][] = [
      ["https://www.linkedin.com/jobs/view/3912345678/?trackingId=abc", /LinkedIn needs a login.*company's own careers page/],
      ["https://www.indeed.com/viewjob?jk=abc", /Indeed blocks automated reading/],
    ];
    for (const [u, re] of cases) {
      await expect(readJobPosting(provider(fetchUrl), u, { fetchImpl, readerImpl, wait })).rejects.toMatchObject({ kind: "fetch_failed", message: expect.stringMatching(re) });
    }
    expect(fetchUrl).not.toHaveBeenCalled();
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(readerImpl).not.toHaveBeenCalled();
  });

  it("a provider that can't read links says to paste", async () => {
    await expect(readJobPosting(provider(undefined), "https://brightloop.example/j", { wait })).rejects.toThrow(/Paste the job description/);
  });

  it("an invalid link is explained", async () => {
    await expect(readJobPosting(provider(vi.fn()), "nonsense ::", { wait })).rejects.toThrow(/starting with https/);
  });

  describe("posting reader step", () => {
    const WORDS = (n: number) => Array.from({ length: n }, (_, i) => `word${i}`).join(" ");
    const posting = (words: number) => ({ title: "Software Engineer I", company: "Brightloop", locations: ["Springfield, IL"], employmentType: "Full time", datePosted: "2026-10-01", validThrough: "", salary: "", identifier: "", descriptionText: WORDS(words) });
    const WD = "https://brightloop.wd5.myworkdayjobs.com/en-US/Careers/job/Remote/Engineer_R1";
    const none = (closed = false) => vi.fn(async () => ({ kind: "none" as const, closed }));

    it("a posting from the reader is used: no Claude call, built text, progress step", async () => {
      const fetchUrl = vi.fn();
      const readerImpl = vi.fn(async () => ({ kind: "posting" as const, posting: posting(120), closed: false }));
      const steps: string[] = [];
      const text = await readJobPosting(provider(fetchUrl), "https://careers.brightloop.example/job/1?utm_source=x", { readerImpl, onStep: (s) => steps.push(s), wait });
      expect(text.split("\n").slice(0, 5)).toEqual(["Software Engineer I", "Brightloop", "Location: Springfield, IL", "Employment type: Full time", "Posted: 2026-10-01"]);
      expect(text).toContain("word119");
      expect(fetchUrl).not.toHaveBeenCalled();
      expect(steps).toEqual(["Reading the posting from the company's page..."]);
    });

    it("needs at least 80 words of description, otherwise Claude's reader is tried", async () => {
      const fetchUrl = vi.fn(async (_u: string) => page(POSTING));
      await readJobPosting(provider(fetchUrl), "https://careers.brightloop.example/job/1", { readerImpl: vi.fn(async () => ({ kind: "posting" as const, posting: posting(79), closed: false })), wait });
      expect(fetchUrl).toHaveBeenCalledTimes(1);
      const ok = vi.fn(async () => ({ kind: "posting" as const, posting: posting(80), closed: false }));
      await readJobPosting(provider(fetchUrl), "https://careers.brightloop.example/job/1", { readerImpl: ok, wait });
      expect(fetchUrl).toHaveBeenCalledTimes(1);
    });

    it("a posting that is also marked closed is used, with a quiet note", async () => {
      const notes: string[] = [];
      await readJobPosting(provider(vi.fn()), "https://careers.brightloop.example/job/1", { readerImpl: async () => ({ kind: "posting", posting: posting(100), closed: true }), onNote: (n) => notes.push(n), wait });
      expect(notes).toEqual(["The page also says this job may be filled. Check before applying."]);
    });

    it("no posting and a closed page: says so, no paste prompt, no AI call", async () => {
      const fetchUrl = vi.fn();
      const err = await readJobPosting(provider(fetchUrl), "https://careers.brightloop.example/job/1", { readerImpl: none(true), wait }).catch((e) => e);
      expect(err).toBeInstanceOf(ClosedPostingError);
      expect(err.message).toBe("This posting looks closed or filled.");
      expect(fetchUrl).not.toHaveBeenCalled();
    });

    it("no posting and not closed: falls through to Claude, then the shell check", async () => {
      const fetchUrl = vi.fn(async (_u: string) => page(SHELL));
      await expect(readJobPosting(provider(fetchUrl), "https://careers.brightloop.example/job/1", { readerImpl: none(), wait })).rejects.toThrow(NOT_A_POSTING_MESSAGE);
      expect(fetchUrl).toHaveBeenCalledTimes(1);
    });

    it("Workday is read by the reader first (no upfront refusal)", async () => {
      const readerImpl = vi.fn(async () => ({ kind: "posting" as const, posting: posting(150), closed: false }));
      const fetchUrl = vi.fn();
      expect(await readJobPosting(provider(fetchUrl), WD, { readerImpl, wait })).toContain("Software Engineer I");
      expect(readerImpl).toHaveBeenCalledWith(WD);
      expect(fetchUrl).not.toHaveBeenCalled();
    });

    it("Workday and Apple with nothing from the reader: the plain message, Claude is not asked", async () => {
      const fetchUrl = vi.fn();
      await expect(readJobPosting(provider(fetchUrl), WD, { readerImpl: none(), wait })).rejects.toMatchObject({ kind: "fetch_failed", message: "Workday pages load with JavaScript, so the app can't read them. Paste the description instead." });
      await expect(readJobPosting(provider(fetchUrl), "https://jobs.apple.com/en-us/details/200000000/x", { readerImpl: none(), wait })).rejects.toThrow(/^Apple pages load with JavaScript/);
      expect(fetchUrl).not.toHaveBeenCalled();
    });

    it("LinkedIn and Indeed never reach the reader", async () => {
      const readerImpl = vi.fn();
      for (const u of ["https://www.linkedin.com/jobs/view/1", "https://www.indeed.com/viewjob?jk=1"]) await expect(readJobPosting(provider(vi.fn()), u, { readerImpl, wait })).rejects.toThrow();
      expect(readerImpl).not.toHaveBeenCalled();
    });

    it("a Greenhouse link whose API is down tries the reader before Claude", async () => {
      const order: string[] = [];
      const fetchUrl = vi.fn(async (_u: string) => (order.push("claude"), page(POSTING)));
      await readJobPosting(provider(fetchUrl), GH, {
        fetchImpl: async () => {
          throw new TypeError("Failed to fetch");
        },
        readerImpl: async () => (order.push("reader"), { kind: "none", closed: false }),
        wait,
      });
      expect(order).toEqual(["reader", "claude"]);
    });
  });
});
