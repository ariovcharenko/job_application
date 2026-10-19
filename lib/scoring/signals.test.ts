import { describe, expect, it, vi } from "vitest";
import type { AIProvider, JsonOptions } from "../ai/provider";
import { extractJobSignals, SIGNALS_MAX_TOKENS } from "./signals";

function fakeProvider(response: unknown): { provider: AIProvider; completeJson: ReturnType<typeof vi.fn> } {
  const completeJson = vi.fn(async <T,>(opts: JsonOptions<T>) => opts.parse!(response));
  return {
    provider: {
      id: "fake",
      complete: vi.fn(),
      completeJson: completeJson as AIProvider["completeJson"],
      listModels: vi.fn(),
      testConnection: vi.fn(),
    },
    completeJson,
  };
}

const VALID_RESPONSE = {
  company: "Acme",
  role: "SWE",
  location: "Remote (US)",
  workMode: "Remote",
  salary: "",
  seniority: "New grad",
  mustHaveSkills: ["React"],
  niceToHaveSkills: [],
  visaSignal: "unknown",
  visaEvidence: "",
  citizenshipRequired: false,
  clearanceRequired: false,
  freshness: "unknown",
  freshnessEvidence: "",
  optSignal: "unknown" as const,
  optEvidence: "",
  minYearsExperience: -1,
  degreeRequired: "none" as const,
};

describe("extractJobSignals", () => {
  it("calls the fast tier with a JSON schema and today's date in the system prompt", async () => {
    const { provider, completeJson } = fakeProvider(VALID_RESPONSE);
    const result = await extractJobSignals(provider, "We are hiring a SWE.", "2026-09-21");
    expect(result).toEqual(VALID_RESPONSE);
    const opts = completeJson.mock.calls[0][0] as JsonOptions<unknown>;
    expect(opts.tier).toBe("fast");
    expect(opts.system).toContain("2026-09-21");
    expect(opts.prompt).toContain("We are hiring a SWE.");
    expect(opts.schema).toMatchObject({ type: "object", additionalProperties: false });
  });

  it("truncates an extremely long paste instead of sending it all", async () => {
    const { provider, completeJson } = fakeProvider(VALID_RESPONSE);
    await extractJobSignals(provider, "x".repeat(50_000), "2026-09-21");
    const opts = completeJson.mock.calls[0][0] as JsonOptions<unknown>;
    expect((opts.prompt as string).length).toBeLessThan(30_000);
  });

  it("rejects a response with an invalid enum value instead of returning it silently", async () => {
    const { provider } = fakeProvider({ ...VALID_RESPONSE, visaSignal: "definitely-yes" });
    await expect(extractJobSignals(provider, "text", "2026-09-21")).rejects.toThrow();
  });
});

describe("extractJobSignals call options", () => {
  it("caps output tokens with headroom over a realistic full answer (about 500 tokens)", () => {
    const full = {
      ...VALID_RESPONSE,
      company: "Leafwise Inc.",
      role: "Software Engineer, Platform (New Grad)",
      location: "Austin, TX (Hybrid, 3 days in office)",
      salary: "$120,000 - $150,000 per year",
      mustHaveSkills: ["TypeScript", "React", "Node.js", "PostgreSQL", "AWS", "Docker", "Kubernetes", "REST APIs", "GraphQL", "Python", "Go", "Redis", "Kafka", "CI/CD", "distributed systems"],
      niceToHaveSkills: ["Terraform", "gRPC", "Rust", "Datadog", "Next.js", "Swift", "Figma", "Spark"],
      visaSignal: "no-sponsorship" as const,
      visaEvidence: "We are unable to sponsor employment visas now or in the future for this position.",
      freshness: "within_week" as const,
      freshnessEvidence: "Posted 3 days ago",
      optSignal: "excludes-opt" as const,
      optEvidence: "Must be authorized to work in the U.S. without sponsorship now or in the future.",
      minYearsExperience: 2,
      degreeRequired: "bachelors" as const,
    };
    const estimatedTokens = Math.ceil(JSON.stringify(full).length / 3.5);
    expect(estimatedTokens).toBeLessThan(SIGNALS_MAX_TOKENS / 2);
  });

  it("sends the fast tier, a cached system prompt, the abort signal and a trimmed posting", async () => {
    const { provider, completeJson } = fakeProvider(VALID_RESPONSE);
    const ctl = new AbortController();
    const long = ["Engineer", "Acme - Remote", ...Array.from({ length: 400 }, (_, i) => `Fun fact ${i} about our snack shelf and game nights.`), "Benefits", "Free lunch and a gym.", "We cannot sponsor visas."].join("\n");
    await extractJobSignals(provider, long, "2026-10-19", { signal: ctl.signal });
    const opts = completeJson.mock.calls[0][0] as JsonOptions<unknown>;
    expect(opts.tier).toBe("fast");
    expect(opts.cacheSystem).toBe(true);
    expect(opts.maxTokens).toBe(SIGNALS_MAX_TOKENS);
    expect(opts.signal).toBe(ctl.signal);
    expect(opts.prompt.length).toBeLessThan(9000);
    expect(opts.prompt).toContain("We cannot sponsor visas.");
  });
});
