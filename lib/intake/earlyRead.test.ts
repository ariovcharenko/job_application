import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "../db";
import { DEFAULT_PREFERENCES } from "../defaults";
import { UNKNOWN_CANDIDATE, type CandidateFacts } from "../eligibility/candidate";
import { resetJevThrottle } from "../ai/jev";
import { saveEarlySkip } from "./save";
import { EARLY_QUESTIONS, earlyPills, interviewFocusOf, runEarlyRead, skipOffer, toEarlyRead, trimForEarlyRead, type EarlyRead } from "./earlyRead";

const ON = { ...DEFAULT_PREFERENCES.mustHaves, workAuth: true, clearance: true };
const OFF = { ...ON, workAuth: false, clearance: false };
const NEEDS: CandidateFacts = { ...UNKNOWN_CANDIDATE, sponsorship: "yes", needsSponsorship: true, onStudentVisa: true, visaStatusSet: true };
const read = (o: Partial<EarlyRead> = {}): EarlyRead => ({ noSponsor: 0, noOpt: 0, citizenOrClearance: 0, workStyle: null, interviewFocus: null, ...o });

describe("trimForEarlyRead", () => {
  it("keeps short text whole and caps long text, keeping the relevant paragraphs", () => {
    expect(trimForEarlyRead("  hello   world ")).toBe("hello world");
    const filler = Array.from({ length: 200 }, (_, i) => `Paragraph ${i} about our wonderful snacks and culture.`).join("\n");
    const long = `Intro line.\n${filler}\nWe cannot sponsor work visas for this role.\n${filler}`;
    const out = trimForEarlyRead(long, 1000);
    expect(out.length).toBeLessThanOrEqual(1000);
    expect(out).toContain("cannot sponsor work visas");
  });
});

describe("questions", () => {
  it("are short, positive and well-formed", () => {
    expect(EARLY_QUESTIONS.noSponsor.type).toBe("noul");
    expect(Object.keys((EARLY_QUESTIONS.workStyle as { criteria: object }).criteria)[0]).toBe("not_stated");
    expect(Object.keys(EARLY_QUESTIONS)).toHaveLength(5);
  });
});

describe("toEarlyRead", () => {
  it("reads typed answers and ignores malformed ones", () => {
    const r = toEarlyRead({
      model: "m",
      answers: {
        noSponsor: { type: "noul", noul: 0.95 },
        noOpt: { type: "noul", noul: 7 },
        workStyle: { type: "choice", choice: "hybrid", confidence: 0.8, probabilities: {} },
        interviewFocus: { type: "choice", choice: "made_up", confidence: 0.9, probabilities: {} },
      },
    });
    expect(r).toEqual({ noSponsor: 0.95, noOpt: 0, citizenOrClearance: 0, workStyle: { value: "hybrid", confidence: 0.8 }, interviewFocus: null });
  });
});

describe("skipOffer", () => {
  it("offers only at 0.9+ for a must-have that is on and applies to her", () => {
    expect(skipOffer(read({ noSponsor: 0.95 }), ON, NEEDS)).toEqual({ reason: "won't sponsor" });
    expect(skipOffer(read({ noSponsor: 0.89 }), ON, NEEDS)).toBeNull();
    expect(skipOffer(read({ noOpt: 0.92 }), ON, NEEDS)?.reason).toMatch(/OPT/);
  });
  it("does not offer when the must-have is off, or the candidate does not need sponsorship, or sponsorship is unknown", () => {
    expect(skipOffer(read({ noSponsor: 0.99 }), OFF, NEEDS)).toBeNull();
    expect(skipOffer(read({ noSponsor: 0.99 }), ON, { ...NEEDS, sponsorship: "no", needsSponsorship: false })).toBeNull();
    expect(skipOffer(read({ noSponsor: 0.99 }), ON, UNKNOWN_CANDIDATE)).toBeNull();
  });
  it("handles citizenship and clearance", () => {
    expect(skipOffer(read({ citizenOrClearance: 0.95 }), { ...OFF, clearance: true }, UNKNOWN_CANDIDATE)?.reason).toMatch(/clearance/);
    expect(skipOffer(read({ citizenOrClearance: 0.95 }), { ...OFF, workAuth: true }, NEEDS)?.reason).toMatch(/citizenship/);
    expect(skipOffer(read({ citizenOrClearance: 0.95 }), { ...OFF, workAuth: true }, { ...NEEDS, isCitizen: true })).toBeNull();
    expect(skipOffer(read({ citizenOrClearance: 0.95 }), { ...OFF, workAuth: true }, UNKNOWN_CANDIDATE)).toBeNull();
  });
});

describe("interviewFocusOf", () => {
  it("needs adequate confidence", () => {
    expect(interviewFocusOf(read({ interviewFocus: { value: "coding", confidence: 0.75 } }))).toBe("coding");
    expect(interviewFocusOf(read({ interviewFocus: { value: "coding", confidence: 0.5 } }))).toBeNull();
    expect(interviewFocusOf(null)).toBeNull();
  });
});

describe("earlyPills", () => {
  it("never shows a pass: nothing found is quiet, a flag only at 0.9+", () => {
    expect(earlyPills(read(), ON).every((p) => p.tone === "quiet")).toBe(true);
    expect(earlyPills(read({ noSponsor: 0.95 }), ON)[0]).toMatchObject({ tone: "flag", label: expect.stringContaining("sponsor") });
    expect(earlyPills(read(), OFF)).toEqual([]);
  });
});

describe("runEarlyRead", () => {
  beforeEach(() => resetJevThrottle());
  it("returns null with no key, without any request", async () => {
    const f = vi.fn();
    expect(await runEarlyRead("", "text", { fetch: f as unknown as typeof fetch })).toBeNull();
    expect(await runEarlyRead(undefined, "text", { fetch: f as unknown as typeof fetch })).toBeNull();
    expect(f).not.toHaveBeenCalled();
  });
  it("returns null on any Jev error", async () => {
    const f = vi.fn().mockRejectedValue(new TypeError("down"));
    expect(await runEarlyRead("k-123456789", "text", { fetch: f as unknown as typeof fetch, sleep: async () => {} })).toBeNull();
  });
  it("sends one batched request with all five questions", async () => {
    const f = vi.fn().mockImplementation(async () => new Response(JSON.stringify({ model: "m", answers: { noSponsor: { type: "noul", noul: 0.2 } } })));
    const r = await runEarlyRead("k-123456789", "We offer hybrid work.", { fetch: f as unknown as typeof fetch, sleep: async () => {} });
    expect(f).toHaveBeenCalledTimes(1);
    expect(Object.keys(JSON.parse(f.mock.calls[0][1].body).questions)).toHaveLength(5);
    expect(r?.noSponsor).toBe(0.2);
  });
});

describe("Jev never reaches the verdict (decisions #4 and #7)", () => {
  it("scoring, criteria, decision and analyze code do not import the Jev client or earlyRead", () => {
    for (const f of ["lib/scoring/score.ts", "lib/scoring/criteria.ts", "lib/intake/decision.ts", "lib/intake/analyze.ts", "lib/eligibility/candidate.ts"]) {
      expect(readFileSync(f, "utf8"), f).not.toMatch(/ai\/jev|earlyRead/);
    }
  });
});

describe("saveEarlySkip", () => {
  beforeEach(async () => {
    await Promise.all(db.tables.map((t) => t.clear()));
  });
  it("saves a skipped row with the reason and no score", async () => {
    const id = await saveEarlySkip({ url: "https://boards.greenhouse.io/acme/jobs/1", jdText: "text", reason: "won't sponsor" });
    const row = await db.applications.get(id);
    expect(row).toMatchObject({ triage: "skipped", stage: "Saved", company: "boards.greenhouse.io" });
    expect(row?.notes).toContain("won't sponsor");
    expect(row?.fitBreakdown).toBeUndefined();
  });
  it("only marks an existing row for the same link", async () => {
    const id = await saveEarlySkip({ url: "https://boards.greenhouse.io/acme/jobs/1", jdText: "a", reason: "r" });
    const again = await saveEarlySkip({ url: "https://boards.greenhouse.io/acme/jobs/1?utm_source=x", jdText: "a", reason: "r2" });
    expect(again).toBe(id);
    expect(await db.applications.count()).toBe(1);
  });
});
