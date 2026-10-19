import { describe, expect, it } from "vitest";
import { UNKNOWN_CANDIDATE, type CandidateFacts } from "../eligibility/candidate";
import { skipOffer, type EarlyRead } from "./earlyRead";
import { quickResult, type QuickInput } from "./quick";

const MASTER = "SKILLS\nLanguages: Python, TypeScript, SQL\nTools: React, Docker, Git, PostgreSQL\n";
const JD = "We use Python, TypeScript, React, Docker and Kubernetes with Rust services and Go tooling on AWS.";
const ON = { experience: true, degree: true, location: true, workAuth: true, clearance: true };
const NONE = { experience: false, degree: false, location: false, workAuth: false, clearance: false };
const quiet: EarlyRead = { noSponsor: 0, noOpt: 0, citizenOrClearance: 0, workStyle: null, level: null, degree: null, interviewFocus: null };
const needsVisa: CandidateFacts = { ...UNKNOWN_CANDIDATE, sponsorship: "yes", needsSponsorship: true, onStudentVisa: true, visaStatusSet: true };
const base = (o: Partial<QuickInput> = {}): QuickInput => ({
  jdText: JD, early: quiet, mustHaves: ON, candidate: needsVisa, master: MASTER, prefs: { workModes: ["Remote", "Hybrid"] }, ...o,
});

describe("quickResult", () => {
  it("gives a code-only skills estimate that is never strong or a pass", () => {
    const r = quickResult(base())!;
    expect(r.kind).toBe("quick-match");
    expect(r.percent).toBeGreaterThan(0);
    expect(r.percent).toBeLessThan(100);
    expect(r.headline.strong).toBe(false);
    expect(r.headline.label).toBe("Quick estimate");
    expect(r.notChecked).toEqual(["Level", "Degree", "Location", "Work auth", "Clearance"]);
    expect(r.headline.summary).toMatch(/Not checked yet/);
  });
  it("works with no early read (no Jev key)", () => {
    const r = quickResult(base({ early: null }))!;
    expect(r.kind).toBe("quick-match");
    expect(r.notChecked).toContain("Work auth");
  });
  it("lists only the must-haves she has on", () => {
    expect(quickResult(base({ mustHaves: { ...NONE, degree: true } }))!.notChecked).toEqual(["Degree"]);
    expect(quickResult(base({ mustHaves: NONE }))!.headline.summary).toBe("");
  });
  it("is null with nothing useful: no master, no text, or too few technologies", () => {
    expect(quickResult(base({ master: "" }))).toBeNull();
    expect(quickResult(base({ jdText: "" }))).toBeNull();
    expect(quickResult(base({ jdText: "Join our friendly team and grow." }))).toBeNull();
  });
  it("does not count a below-bar noul as a fail", () => {
    expect(quickResult(base({ early: { ...quiet, noSponsor: 0.89, noOpt: 0.5, citizenOrClearance: 0.8 } }))!.kind).toBe("quick-match");
  });
  it("flags a confident no-sponsorship posting when she needs sponsorship", () => {
    const r = quickResult(base({ early: { ...quiet, noSponsor: 0.95 } }))!;
    expect(r.kind).toBe("not-a-fit");
    expect(r.headline.kind).toBe("not-a-fit");
    expect(r.headline.strong).toBe(false);
    expect(r.reason).toMatch(/won't sponsor/);
    expect(r.notChecked).not.toContain("Work auth");
  });
  it("ignores no-sponsorship when she does not need it, or it is unknown", () => {
    const no: CandidateFacts = { ...UNKNOWN_CANDIDATE, sponsorship: "no" };
    expect(quickResult(base({ candidate: no, early: { ...quiet, noSponsor: 1 } }))!.kind).toBe("quick-match");
    expect(quickResult(base({ candidate: UNKNOWN_CANDIDATE, early: { ...quiet, noSponsor: 1, noOpt: 1 } }))!.kind).toBe("quick-match");
  });
  it("ignores OPT exclusion unless she is on a student visa", () => {
    const h1: CandidateFacts = { ...needsVisa, onStudentVisa: false };
    expect(quickResult(base({ candidate: h1, early: { ...quiet, noOpt: 1 } }))!.kind).toBe("quick-match");
    expect(quickResult(base({ early: { ...quiet, noOpt: 0.9 } }))!.reason).toMatch(/OPT/);
  });
  it("respects must-haves that are off", () => {
    expect(quickResult(base({ mustHaves: { ...ON, workAuth: false }, early: { ...quiet, noSponsor: 1 } }))!.kind).toBe("quick-match");
  });
  it("clearance and citizenship follow the same rules as skipOffer", () => {
    const e = { ...quiet, citizenOrClearance: 0.95 };
    expect(quickResult(base({ early: e }))!.kind).toBe("not-a-fit");
    const citizen: CandidateFacts = { ...UNKNOWN_CANDIDATE, isCitizen: true, visaStatusSet: true };
    expect(quickResult(base({ early: e, candidate: citizen, mustHaves: { ...ON, clearance: false } }))!.kind).toBe("quick-match");
    expect(quickResult(base({ early: e, candidate: UNKNOWN_CANDIDATE, mustHaves: { ...ON, clearance: false } }))!.kind).toBe("quick-match");
  });
  it("agrees with skipOffer on every sponsorship/clearance combination", () => {
    const cands = [needsVisa, UNKNOWN_CANDIDATE, { ...UNKNOWN_CANDIDATE, isCitizen: true, visaStatusSet: true }];
    for (const noSponsor of [0, 0.95]) for (const noOpt of [0, 0.95]) for (const cc of [0, 0.95]) {
      for (const cand of cands) {
        for (const mh of [ON, { ...ON, clearance: false }, NONE]) {
          const e = { ...quiet, noSponsor, noOpt, citizenOrClearance: cc };
          expect(quickResult(base({ early: e, candidate: cand, mustHaves: mh }))?.kind === "not-a-fit").toBe(skipOffer(e, mh, cand) !== null);
        }
      }
    }
  });
  it("uses Jev's work style only at confidence >= 0.7 against accepted styles", () => {
    const ws = (value: "remote" | "hybrid" | "onsite", confidence: number): EarlyRead => ({ ...quiet, workStyle: { value, confidence } });
    const r = quickResult(base({ early: ws("onsite", 0.8) }))!;
    expect(r.kind).toBe("not-a-fit");
    expect(r.reason).toMatch(/on-site/);
    expect(quickResult(base({ early: ws("onsite", 0.69) }))!.kind).toBe("quick-match");
    expect(quickResult(base({ early: ws("hybrid", 0.95) }))!.kind).toBe("quick-match");
    expect(quickResult(base({ early: ws("onsite", 0.95), mustHaves: { ...ON, location: false } }))!.kind).toBe("quick-match");
    expect(quickResult(base({ early: ws("onsite", 0.95), prefs: { workModes: [] } }))!.kind).toBe("quick-match");
  });
  it("a failing job still carries the skills percent as a small aside", () => {
    const r = quickResult(base({ early: { ...quiet, noSponsor: 1 } }))!;
    expect(r.percent).not.toBeNull();
    expect(r.headline.aside).toMatch(/Skills overlap/);
  });
  it("not-a-fit works without a master profile (no percent)", () => {
    const r = quickResult(base({ master: "", early: { ...quiet, noSponsor: 1 } }))!;
    expect(r.kind).toBe("not-a-fit");
    expect(r.percent).toBeNull();
  });
  it("combines several fails in one line", () => {
    expect(quickResult(base({ early: { ...quiet, noSponsor: 1, noOpt: 1 } }))!.reason).toMatch(/won't sponsor and excludes OPT/);
  });
});

describe("level and degree from the early read", () => {
  const lv = (value: "intern" | "new_grad_entry" | "mid" | "senior", confidence: number): EarlyRead => ({ ...quiet, level: { value, confidence } });
  const dg = (value: "bachelors" | "masters" | "phd", confidence: number): EarlyRead => ({ ...quiet, degree: { value, confidence } });
  const prefsFor = (experienceLevel: "new-grad" | "senior" | "mid" | "") => ({ workModes: ["Remote", "Hybrid"] as ("Remote" | "Hybrid")[], experienceLevel });
  const bachelors: CandidateFacts = { ...UNKNOWN_CANDIDATE, degreeLevel: "bachelors" };

  it("a confident senior posting fails Level for a new grad", () => {
    const r = quickResult(base({ early: lv("senior", 0.95), prefs: prefsFor("new-grad") }))!;
    expect(r.kind).toBe("not-a-fit");
    expect(r.reason).toMatch(/senior role/);
    expect(r.notChecked).not.toContain("Level");
  });
  it("needs 0.9, the level must-have on, a chosen level, and a level that senior is above", () => {
    expect(quickResult(base({ early: lv("senior", 0.89), prefs: prefsFor("new-grad") }))!.kind).toBe("quick-match");
    expect(quickResult(base({ early: lv("senior", 0.95), prefs: prefsFor("new-grad"), mustHaves: { ...ON, experience: false } }))!.kind).toBe("quick-match");
    expect(quickResult(base({ early: lv("senior", 0.95), prefs: prefsFor("") }))!.kind).toBe("quick-match");
    expect(quickResult(base({ early: lv("senior", 0.95), prefs: prefsFor("senior") }))!.kind).toBe("quick-match");
  });
  it("mid, new grad and intern readings are never a fail", () => {
    for (const v of ["mid", "new_grad_entry", "intern"] as const) {
      expect(quickResult(base({ early: lv(v, 1), prefs: prefsFor("new-grad") }))!.kind).toBe("quick-match");
    }
  });
  it("degree is only a warning, never a fail", () => {
    const r = quickResult(base({ early: dg("masters", 0.99), candidate: bachelors }))!;
    expect(r.kind).toBe("quick-match");
    expect(r.warnings[0]).toMatch(/master's degree/);
    expect(r.notChecked).toContain("Degree");
    expect(quickResult(base({ early: dg("masters", 0.69), candidate: bachelors }))!.warnings).toEqual([]);
    expect(quickResult(base({ early: dg("bachelors", 0.99), candidate: bachelors }))!.warnings).toEqual([]);
    expect(quickResult(base({ early: dg("phd", 0.99), candidate: UNKNOWN_CANDIDATE }))!.warnings).toEqual([]);
    expect(quickResult(base({ early: dg("phd", 0.99), candidate: bachelors, mustHaves: { ...ON, degree: false } }))!.warnings).toEqual([]);
  });
  it("agrees with skipOffer on every level combination", () => {
    const cands = [needsVisa, UNKNOWN_CANDIDATE];
    for (const value of ["intern", "new_grad_entry", "mid", "senior"] as const) for (const confidence of [0.5, 0.8, 0.95]) {
      for (const level of ["new-grad", "mid", "senior", ""] as const) for (const cand of cands) {
        for (const mh of [ON, { ...ON, experience: false }, NONE]) {
          const e = lv(value, confidence);
          const prefs = prefsFor(level);
          expect(quickResult(base({ early: e, candidate: cand, mustHaves: mh, prefs }))?.kind === "not-a-fit").toBe(skipOffer(e, mh, cand, prefs) !== null);
        }
      }
    }
  });
});
