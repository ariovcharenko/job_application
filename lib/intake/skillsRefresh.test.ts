import { describe, expect, it, vi } from "vitest";
import type { AIProvider, JsonOptions } from "../ai/provider";
import { DEFAULT_PREFERENCES } from "../defaults";
import { ALEX_MASTER } from "../resume/master/__fixtures__/skillsEval";
import { extractJobSignals } from "../scoring/signals";
import { blankApplication } from "../tracker/blank";
import type { Application } from "../types";
import { mentionedSkills } from "./analyze";
import { readBreakdown, refreshBreakdowns } from "./stored";

const app = (o: Partial<Application>, breakdown: object): Application => ({ ...blankApplication(), ...o, fitBreakdown: JSON.stringify(breakdown) });

describe("refreshBreakdowns re-matches stored skill lists for free", () => {
  const base = {
    decision: { canApply: true, filters: [], failed: [], unclear: [] },
    criteria: [{ key: "degree", label: "Degree", status: "pass", detail: "" }],
  };

  it("re-reads an old row's messy lists: splits pairs, merges spellings, adds evidence, keeps the shape", () => {
    const old = {
      ...base,
      skills: {
        percent: 10,
        basis: "skills",
        required: { have: [], gap: ["Python/Java", "Experience with AWS (EC2, S3)", "Postgres", "PostgreSQL", "Strong communication skills", "Kubernetes"] },
        preferred: { have: [], gap: ["experience with Docker"] },
      },
    };
    const [changed] = refreshBreakdowns([app({ company: "Northwind" }, old)], DEFAULT_PREFERENCES.mustHaves, ALEX_MASTER);
    const skills = readBreakdown(changed.app)!.skills!;
    const next = JSON.parse(changed.fitBreakdown).skills;
    expect(next.required.have).toEqual(["Python", "Java", "AWS", "Postgres"]);
    expect(next.required.gap).toEqual(["Kubernetes"]);
    expect(next.preferred.have).toEqual(["Docker"]);
    expect(next.percent).toBe(Math.round((0.75 * 4) / 5 * 100 + 0.25 * 100));
    expect(next.required.evidence.Postgres).toBeTruthy();
    // Same fields as before, plus the optional evidence.
    expect(Object.keys(next).sort()).toEqual(Object.keys(skills).sort());
    expect(next.basis).toBe("skills");
  });

  it("does not change a row twice", () => {
    const old = { ...base, skills: { percent: 0, basis: "skills", required: { have: [], gap: ["Kubernetes"] }, preferred: { have: [], gap: [] } } };
    const first = refreshBreakdowns([app({ company: "A" }, old)], DEFAULT_PREFERENCES.mustHaves, ALEX_MASTER)[0];
    const again = refreshBreakdowns([{ ...first.app, fitBreakdown: first.fitBreakdown }], DEFAULT_PREFERENCES.mustHaves, ALEX_MASTER);
    expect(again).toEqual([]);
  });
});

describe("mentionedSkills (no skills list extracted)", () => {
  const master = "### Skills\n- Frontend: React Native, TypeScript\n- Languages: Python";

  it("does not count React from a React Native mention, or ordinary words as technologies", () => {
    const jd = "Join our spring internship program. You will express ideas clearly, build apps in React Native with TypeScript, and use Python. We spark curiosity.";
    const m = mentionedSkills(jd, master)!;
    const all = [...m.have, ...m.gap];
    expect(all).toEqual(expect.arrayContaining(["React Native", "TypeScript", "Python"]));
    expect(all).not.toContain("React");
    expect(all).not.toContain("Spring");
    expect(all).not.toContain("Express");
    expect(all).not.toContain("Spark");
  });

  it("does not read 'Go to market' as the language", () => {
    const jd = "Own our Go to market planning. Write Python and TypeScript tests, and some Rust.";
    const all = (m => [...m.have, ...m.gap])(mentionedSkills(jd, master)!);
    expect(all).not.toContain("Go");
  });
});

describe("extractJobSignals cleans the skill lists by code", () => {
  const response = {
    company: "Acme", role: "SWE", location: "", workMode: "Remote", salary: "", seniority: "", visaSignal: "unknown", visaEvidence: "",
    citizenshipRequired: false, clearanceRequired: false, freshness: "unknown", freshnessEvidence: "", optSignal: "unknown", optEvidence: "",
    minYearsExperience: 3, degreeRequired: "bachelors",
    mustHaveSkills: ["Python/Java", "3+ years of experience", "Bachelor's degree in Computer Science", "Strong communication skills", "Experience with AWS (EC2, S3)", "Postgres", "PostgreSQL"],
    niceToHaveSkills: ["Python", "Kubernetes", "CI/CD pipelines"],
  };

  it("splits, drops degrees, years and soft skills, merges duplicates, and keeps preferred skills out of required", async () => {
    const completeJson = vi.fn(async <T,>(opts: JsonOptions<T>) => opts.parse!(response));
    const provider = { id: "fake", complete: vi.fn(), completeJson: completeJson as AIProvider["completeJson"], listModels: vi.fn(), testConnection: vi.fn() } as AIProvider;
    const s = await extractJobSignals(provider, "We are hiring.", "2026-10-18");
    expect(s.mustHaveSkills).toEqual(["Python", "Java", "AWS", "Postgres"]);
    expect(s.niceToHaveSkills).toEqual(["Kubernetes", "CI/CD pipelines"]);
    // The years and degree stay available as their own signals.
    expect(s.minYearsExperience).toBe(3);
    expect(s.degreeRequired).toBe("bachelors");
  });
});
