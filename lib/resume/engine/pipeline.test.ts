import { describe, expect, it } from "vitest";
import type { AIProvider, JsonOptions } from "../../ai/provider";
import { DEMO_EXPERIENCE, DEMO_JOBS } from "../../demo/data";
import { demoFocus, skillLines } from "../../demo/seed";
import { parseMasterExperiences } from "../master/experiences";
import { estimatePageFill, planPage } from "./budget";
import { GENERATE_EFFORT } from "./index";
import { followUpComments, MIN_SHORT_LINES, tailorResume } from "./pipeline";
import type { ResumeDoc } from "./schema";
import { validateResume } from "./validate";
import { applyConfirmations, confirmedForPrompt, placeChoices } from "../gaps";

// The pipeline with a fake model: no network, no key. The "model" writes the demo candidate's own
// lines to the page plan, so every check passes and only the page length varies.

const job = DEMO_JOBS.find((j) => j.signals.company === "Cobalt Payments")!;
const focus = demoFocus(job);
const jobSkills = [...job.signals.mustHaveSkills, ...job.signals.niceToHaveSkills];

/** A page as a model following the plan would write it, from her own lines. */
function plannedPage(opts: { dropSkill?: string; bulletsPerRole?: number } = {}): ResumeDoc {
  const plan = planPage(DEMO_EXPERIENCE, focus);
  const entries = parseMasterExperiences(DEMO_EXPERIENCE);
  const linesOf = (company: string) =>
    entries
      .find((e) => e.company === company)!
      .block.split("\n")
      .filter((l) => /^- /.test(l))
      .map((l) => l.slice(2));
  const entry = (p: { company: string; title: string; dates: string; bullets: number }) => {
    const m = entries.find((e) => e.company === p.company)!;
    return { title: p.title, company: m.company, location: m.location, dates: m.dates, bullets: linesOf(p.company).slice(0, opts.bulletsPerRole ?? p.bullets) };
  };
  return {
    education: [{ school: "University of Washington", location: "Seattle, WA", degree: "B.S. Computer Science", dates: "Jun 2026", bullets: ["GPA: 3.8/4.0"] }],
    experience: plan.roles.map(entry),
    projects: plan.projects.map(entry),
    skills: skillLines(DEMO_EXPERIENCE).map((l) => ({ ...l, items: l.items.filter((i) => i !== opts.dropSkill) })),
    leadership: [{ role: "ACM Student Chapter, Vice President", dates: "Sep 2024 - Present" }],
    meta: { matchedKeywords: [], gaps: [], valuesReflected: [] },
  };
}

/** A fake provider: answers generation with `first`, a revision with `second` (or throws). */
function fakeProvider(first: ResumeDoc, second?: ResumeDoc | Error) {
  const calls: JsonOptions<unknown>[] = [];
  const provider = {
    completeJson: async <T,>(o: JsonOptions<T>) => {
      calls.push(o as JsonOptions<unknown>);
      if (calls.length === 1) return first as T;
      if (second instanceof Error) throw second;
      return { ...(second ?? first), changes: ["Added a bullet."] } as T;
    },
  } as unknown as AIProvider;
  return { provider, calls };
}

const run = (provider: AIProvider, measure: (d: ResumeDoc) => number) =>
  tailorResume({ provider, master: DEMO_EXPERIENCE, company: job.signals.company, jdText: job.jd, jobSkills, requiredSkills: job.signals.mustHaveSkills, focus, measure });

describe("tailorResume", () => {
  it("makes one call at high effort with the page plan when the page comes back full", async () => {
    const { provider, calls } = fakeProvider(plannedPage());
    const out = await run(provider, () => 0.965);
    const fixes = followUpComments(out.result, { jobSkills, requiredSkills: job.signals.mustHaveSkills, measure: () => 0.965, master: DEMO_EXPERIENCE });
    // Her own lines pass every writing check, so nothing is sent back.
    expect(fixes).toEqual([]);
    expect(out.calls).toBe(1);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ tier: "smart", effort: GENERATE_EFFORT, cacheSystem: true });
    expect(GENERATE_EFFORT).toBe("high");
    expect(calls[0].prompt).toMatch(/PAGE PLAN/);
    expect(calls[0].prompt).toMatch(/JOB FOCUS/);
    expect(out.result.flags).toEqual([]);
  });

  it("asks once for the missing lines when the page ends short, and uses the answer", async () => {
    const short = plannedPage({ bulletsPerRole: 2 });
    const full = plannedPage();
    const { provider, calls } = fakeProvider(short, full);
    const out = await run(provider, estimatePageFill);
    expect(calls).toHaveLength(2);
    expect(out.calls).toBe(2);
    expect(calls[1].prompt).toMatch(/lines short of a full page/);
    expect(calls[1].effort).toBe("medium");
    expect(out.result.doc.experience[0].bullets.length).toBeGreaterThan(2);
    expect(out.notes[0]).toMatch(/filled the rest of the page/);
  });

  it("keeps the first draft when the follow-up call fails", async () => {
    const short = plannedPage({ bulletsPerRole: 2 });
    const { provider } = fakeProvider(short, new Error("overloaded"));
    const out = await run(provider, estimatePageFill);
    expect(out.calls).toBe(2);
    expect(out.notes).toEqual([]);
    expect(out.result.doc.experience[0].bullets).toHaveLength(2);
  });

  it("puts back a job skill the model left off the skills lines (code never loses a skill)", async () => {
    const { provider } = fakeProvider(plannedPage({ dropSkill: "PostgreSQL" }));
    const out = await run(provider, () => 0.965);
    expect(out.result.doc.skills.flatMap((l) => l.items)).toContain("PostgreSQL");
    expect(out.result.fixes.join(" ")).toMatch(/Added PostgreSQL to your skills/);
  });
});

describe("tailorResume with skills she confirmed before tailoring", () => {
  it("sends her answers in the one generation call, and the checks accept the placed skill", async () => {
    const shelf = placeChoices(DEMO_EXPERIENCE).find((p) => p.role.company === "ShelfLife")!;
    const confirmed = [
      { skill: "Rust", place: null, how: "" },
      { skill: "Firebase", place: shelf, how: "stored the scans" },
    ];
    const master = applyConfirmations(DEMO_EXPERIENCE, confirmed);
    const page = plannedPage();
    page.projects = [{ title: "Hackathon project", company: "ShelfLife", location: "Seattle, WA", dates: "Oct 2024", bullets: ["Built an Android app in **Kotlin** that stored the scans in **Firebase**"] }];
    page.skills = [...page.skills, { category: "More", items: ["Rust", "Firebase"] }];
    const { provider, calls } = fakeProvider(page);
    const out = await tailorResume({ provider, master, company: job.signals.company, jdText: job.jd, jobSkills: [...jobSkills, "Rust", "Firebase"], focus, measure: () => 0.965, confirmed: confirmedForPrompt(confirmed) });
    expect(calls[0].prompt).toMatch(/SKILLS THE CANDIDATE JUST CONFIRMED/);
    expect(calls[0].prompt).toContain("- Rust: Skills section only.");
    expect(calls[0].prompt).toContain('- Firebase: used in ShelfLife ("stored the scans"). Show it in that entry\'s bullets');
    // Both now count as hers: listed under HAS, not GAPS.
    expect(calls[0].prompt).toMatch(/HAS[^\n]*Rust[^\n]*Firebase/);
    expect(out.result.flags).toEqual([]);
  });
});

describe("followUpComments", () => {
  it("asks for lines only when the page is at least MIN_SHORT_LINES short", () => {
    const checked = validateResume(plannedPage(), DEMO_EXPERIENCE, { jobSkills, focus });
    const input = { jobSkills, requiredSkills: [], master: DEMO_EXPERIENCE };
    expect(followUpComments(checked, { ...input, measure: () => 0.965 - (MIN_SHORT_LINES - 1) / 64.5 })).toEqual([]);
    expect(followUpComments(checked, { ...input, measure: () => 0.8 }).map((c) => c.id)).toEqual(["fill"]);
  });

  it("sends a writing fix code found back to the model, on its spot", () => {
    const doc = plannedPage();
    doc.experience[0].bullets[0] = "Responsible for leveraging synergies to spearhead a robust, cutting-edge refund status service in **Go**";
    const checked = validateResume(doc, DEMO_EXPERIENCE, { jobSkills, focus });
    const comments = followUpComments(checked, { jobSkills, requiredSkills: [], master: DEMO_EXPERIENCE, measure: () => 0.965 });
    expect(comments.length).toBeGreaterThan(0);
    expect(comments.some((c) => c.target?.section === "experience" && c.target.entry === 0 && c.target.bullet === 0)).toBe(true);
  });
});
