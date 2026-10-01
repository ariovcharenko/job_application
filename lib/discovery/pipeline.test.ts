import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AIProvider, JsonOptions } from "../ai/provider";
import { db } from "../db";
import { DEFAULT_PREFERENCES } from "../defaults";
import { blankApplication } from "../tracker/blank";
import type { Preferences } from "../types";
import type { RawPosting } from "./jsearch";
import { matchesCompany, passesPrefilter, runDiscovery } from "./pipeline";
import * as jsearch from "./jsearch";

function posting(overrides: Partial<RawPosting> = {}): RawPosting {
  return {
    source: "jsearch",
    externalId: "id-1",
    url: "https://acme.example/jobs/1",
    company: "Acme",
    title: "Software Engineer, New Grad",
    location: "Remote",
    isRemote: true,
    description: "We sponsor visas. React and TypeScript required.",
    postedAt: Date.now(),
    salaryMin: 90000,
    salaryMax: 110000,
    salaryCurrency: "USD",
    ...overrides,
  };
}

const SIGNALS = {
  company: "Acme",
  role: "Software Engineer, New Grad",
  location: "Remote",
  workMode: "Remote" as const,
  salary: "$90,000 - $110,000",
  seniority: "New grad",
  mustHaveSkills: ["React", "TypeScript"],
  niceToHaveSkills: [],
  visaSignal: "sponsors" as const,
  visaEvidence: "We sponsor visas.",
  citizenshipRequired: false,
  clearanceRequired: false,
  freshness: "unknown" as const,
  freshnessEvidence: "",
  optSignal: "unknown" as const,
  optEvidence: "",
  minYearsExperience: -1,
  degreeRequired: "none" as const,
};

function fakeProvider(): AIProvider {
  const completeJson = vi.fn(async <T,>(opts: JsonOptions<T>) => opts.parse!(SIGNALS));
  return {
    id: "fake",
    complete: vi.fn(),
    completeJson: completeJson as AIProvider["completeJson"],
    listModels: vi.fn(),
    testConnection: vi.fn(),
  };
}

function prefs(overrides: Partial<Preferences> = {}): Preferences {
  return { ...DEFAULT_PREFERENCES, ...overrides };
}

beforeEach(async () => {
  await db.feed.clear();
  await db.applications.clear();
  vi.restoreAllMocks();
});

describe("passesPrefilter", () => {
  it("keeps titles that guess to one of her target roles and drops the rest", () => {
    const p = prefs({ targetRoles: ["SWE"] });
    expect(passesPrefilter("Software Engineer, New Grad", p)).toBe(true);
    expect(passesPrefilter("Warehouse Associate", p)).toBe(false);
  });

  it("keeps everything when no target roles are set", () => {
    expect(passesPrefilter("Warehouse Associate", prefs({ targetRoles: [] }))).toBe(true);
  });
});

describe("matchesCompany", () => {
  it("accepts the searched company with legal suffixes or longer official names", () => {
    expect(matchesCompany("Google LLC", "Google")).toBe(true);
    expect(matchesCompany("Meta Platforms, Inc.", "Meta")).toBe(true);
    expect(matchesCompany("Amazon.com Services LLC", "Amazon")).toBe(true);
    expect(matchesCompany("Block, Inc.", "Block")).toBe(true);
    expect(matchesCompany("salesforce", "Salesforce")).toBe(true);
  });

  it("rejects a different employer, including one that only shares a prefix", () => {
    expect(matchesCompany("Dover Networks LLC", "Google")).toBe(false);
    expect(matchesCompany("Blockchain Labs", "Block")).toBe(false);
    expect(matchesCompany("Metaview", "Meta")).toBe(false);
  });

  it("keeps a posting with no employer name", () => {
    expect(matchesCompany("", "Google")).toBe(true);
  });
});

describe("runDiscovery", () => {
  it("skips postings from other employers before spending an AI call", async () => {
    vi.spyOn(jsearch, "searchJobs").mockResolvedValue({
      postings: [
        posting({ company: "Google LLC", externalId: "g", url: "https://example.com/g" }),
        posting({ company: "Dover Networks", externalId: "d", url: "https://example.com/d" }),
      ],
      requestsRemaining: null,
    });
    const provider = fakeProvider();
    const outcome = await runDiscovery(["Google"], prefs(), "key", provider);

    expect(outcome.added).toBe(1);
    expect(outcome.skippedOtherCompany).toBe(1);
    expect(provider.completeJson).toHaveBeenCalledTimes(1);
    expect((await db.feed.toArray()).map((f) => f.company)).toEqual(["Google LLC"]);
  });

  it("scores and saves a new posting that passes the prefilter", async () => {
    vi.spyOn(jsearch, "searchJobs").mockResolvedValue({ postings: [posting()], requestsRemaining: 199 });
    const outcome = await runDiscovery(["Acme"], prefs(), "key", fakeProvider());

    expect(outcome).toMatchObject({ found: 1, added: 1, skippedExisting: 0, skippedIrrelevant: 0, requestsRemaining: 199 });
    const rows = await db.feed.toArray();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ company: "Acme", fitScore: expect.any(Number), state: "new", visa: "sponsors" });
  });

  it("does not add the same posting twice across two runs", async () => {
    vi.spyOn(jsearch, "searchJobs").mockResolvedValue({ postings: [posting()], requestsRemaining: null });
    await runDiscovery(["Acme"], prefs(), "key", fakeProvider());
    const second = await runDiscovery(["Acme"], prefs(), "key", fakeProvider());

    expect(second).toMatchObject({ added: 0, skippedExisting: 1 });
    expect(await db.feed.count()).toBe(1);
  });

  it("skips a posting whose URL already exists in the tracker, even under a different external id", async () => {
    await db.applications.add({ ...blankApplication(), company: "Acme", url: "https://acme.example/jobs/1" });
    vi.spyOn(jsearch, "searchJobs").mockResolvedValue({ postings: [posting({ externalId: "different-id" })], requestsRemaining: null });
    const outcome = await runDiscovery(["Acme"], prefs(), "key", fakeProvider());

    expect(outcome).toMatchObject({ added: 0, skippedExisting: 1 });
    expect(await db.feed.count()).toBe(0);
  });

  it("drops an irrelevant title before spending an AI call", async () => {
    vi.spyOn(jsearch, "searchJobs").mockResolvedValue({ postings: [posting({ title: "Warehouse Associate" })], requestsRemaining: null });
    const provider = fakeProvider();
    const outcome = await runDiscovery(["Acme"], prefs({ targetRoles: ["SWE"] }), "key", provider);

    expect(outcome).toMatchObject({ added: 0, skippedIrrelevant: 1 });
    expect(provider.completeJson).not.toHaveBeenCalled();
    expect(await db.feed.count()).toBe(0);
  });

  it("keeps searching the remaining companies when one search call fails", async () => {
    vi.spyOn(jsearch, "searchJobs")
      .mockRejectedValueOnce(new Error("JSearch rejected the key."))
      .mockResolvedValueOnce({ postings: [posting({ company: "Beta" })], requestsRemaining: null });
    const outcome = await runDiscovery(["Broken Co", "Beta"], prefs(), "key", fakeProvider());

    expect(outcome.errors).toEqual([{ company: "Broken Co", message: "JSearch rejected the key." }]);
    expect(outcome.added).toBe(1);
    expect(await db.feed.count()).toBe(1);
  });

  it("records a per-posting error without losing the rest of the batch", async () => {
    vi.spyOn(jsearch, "searchJobs").mockResolvedValue({
      postings: [posting({ externalId: "a" }), posting({ externalId: "b", url: "https://acme.example/jobs/2" })],
      requestsRemaining: null,
    });
    const provider = fakeProvider();
    (provider.completeJson as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("boom")).mockImplementationOnce(
      async <T,>(opts: JsonOptions<T>) => opts.parse!(SIGNALS),
    );
    const outcome = await runDiscovery(["Acme"], prefs(), "key", provider);

    expect(outcome.added).toBe(1);
    expect(outcome.errors).toHaveLength(1);
    expect(await db.feed.count()).toBe(1);
  });

  it("reports progress for each company", async () => {
    vi.spyOn(jsearch, "searchJobs").mockResolvedValue({ postings: [posting()], requestsRemaining: null });
    const events: string[] = [];
    await runDiscovery(["Acme"], prefs(), "key", fakeProvider(), (p) => events.push(`${p.company}:${p.status}`));
    expect(events).toEqual(["Acme:searching", "Acme:scoring", "Acme:done"]);
  });
});
