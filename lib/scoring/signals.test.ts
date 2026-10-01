import { describe, expect, it, vi } from "vitest";
import type { AIProvider, JsonOptions } from "../ai/provider";
import { extractJobSignals } from "./signals";

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
