import { beforeEach, describe, expect, it } from "vitest";
import { AIError, type AIProvider, type JsonOptions } from "../../ai/provider";
import { db } from "../../db";
import { DEMO_EXPERIENCE, DEMO_JOBS } from "../../demo/data";
import { demoFocus, skillLines } from "../../demo/seed";
import { blankApplication } from "../../tracker/blank";
import { parseMasterExperiences } from "../master/experiences";
import { estimatePageFill, planPage } from "./budget";
import { ResumeDocSchema, ResumeRevisionSchema, type ResumeDoc } from "./schema";
import { buildVersion, tailorAndSave } from "./persist";
import { tailorResume, type TailorInput } from "./pipeline";
import { getJobResume } from "./save";
import { FIT_LIMIT } from "./trim";

// Reliability of one tailoring run with a fake model: every failure ends in either a valid
// one-page resume or a typed, actionable error. Nothing here touches the network.

const job = DEMO_JOBS.find((j) => j.signals.company === "Cobalt Payments")!;
const focus = demoFocus(job);
const jobSkills = [...job.signals.mustHaveSkills, ...job.signals.niceToHaveSkills];
const header = { name: "Alex Rivera", location: "Austin, TX", links: [] };

function plannedPage(opts: { bulletsPerRole?: number } = {}): ResumeDoc {
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
    skills: skillLines(DEMO_EXPERIENCE),
    leadership: [{ role: "ACM Student Chapter, Vice President", dates: "Sep 2024 - Present" }],
    meta: { matchedKeywords: [], gaps: [], valuesReflected: [] },
  };
}

type Answer = ResumeDoc | Error | ((o: JsonOptions<unknown>) => ResumeDoc | Promise<ResumeDoc>);
/** A fake provider answering call 1, 2, ... with the given answers (a revision gets `changes`). */
function scripted(...answers: Answer[]) {
  const calls: JsonOptions<unknown>[] = [];
  const provider = {
    id: "fake",
    completeJson: async <T,>(o: JsonOptions<T>) => {
      const i = calls.push(o as JsonOptions<unknown>) - 1;
      const a = answers[Math.min(i, answers.length - 1)];
      if (a instanceof Error) throw a;
      const doc = typeof a === "function" ? await a(o as JsonOptions<unknown>) : a;
      return (i === 0 ? doc : { ...doc, changes: ["Done."] }) as T;
    },
  } as unknown as AIProvider;
  return { provider, calls };
}

const base = (provider: AIProvider, extra: Partial<TailorInput> = {}): TailorInput => ({
  provider,
  master: DEMO_EXPERIENCE,
  company: job.signals.company,
  jdText: job.jd,
  jobSkills,
  requiredSkills: job.signals.mustHaveSkills,
  focus,
  measure: estimatePageFill,
  ...extra,
});

const bulletCount = (d: ResumeDoc) => [...d.experience, ...(d.projects ?? [])].reduce((n, e) => n + e.bullets.length, 0);

describe("the model's answer fails", () => {
  it.each([
    ["invalid_output", "The model returned text that is not valid JSON."],
    ["truncated", "The response was cut off. Try again with a shorter input."],
    ["refusal", "The model declined this request."],
    ["network", "Can't reach the API."],
    ["rate_limit", "Too many requests, try again in a minute."],
  ] as const)("%s: the run rejects with that typed error and nothing is half-written", async (kind, message) => {
    const { provider, calls } = scripted(new AIError(kind, message));
    await expect(tailorResume(base(provider))).rejects.toMatchObject({ name: "AIError", kind, message });
    expect(calls).toHaveLength(1);
  });

  it("a network error, then a retry, ends in a valid resume (a run keeps no state)", async () => {
    const down = scripted(new AIError("network", "Can't reach the API."));
    await expect(tailorResume(base(down.provider))).rejects.toMatchObject({ kind: "network" });
    const up = scripted(plannedPage());
    const out = await tailorResume(base(up.provider));
    expect(out.result.doc.experience.length).toBeGreaterThan(0);
    expect(out.result.flags).toEqual([]);
  });

  it("the schema rejects a partial answer (a missing section), so the provider reports invalid_output", () => {
    const { experience: _gone, ...partial } = plannedPage();
    expect(ResumeDocSchema.safeParse(partial).success).toBe(false);
    expect(ResumeDocSchema.safeParse({ ...plannedPage(), skills: "Go, SQL" }).success).toBe(false);
    expect(ResumeDocSchema.safeParse(null).success).toBe(false);
  });

  it("both providers' shapes parse: optional projects and warnings may be absent, extra keys are ignored", () => {
    const doc = plannedPage();
    delete doc.projects;
    expect(ResumeDocSchema.safeParse(doc).success).toBe(true);
    expect(ResumeDocSchema.safeParse({ ...plannedPage(), extra: 1, meta: { ...doc.meta, warnings: [] } }).success).toBe(true);
    expect(ResumeRevisionSchema.safeParse({ ...plannedPage(), changes: ["x"] }).success).toBe(true);
    expect(ResumeRevisionSchema.safeParse(plannedPage()).success).toBe(false);
  });
});

describe("a valid answer with unusable content", () => {
  const empty = (): ResumeDoc => ({ ...plannedPage(), experience: [], projects: [] });

  it("a resume with no experience or projects at all is an error she can act on, not a blank page", async () => {
    const { provider } = scripted(empty());
    await expect(tailorResume(base(provider))).rejects.toMatchObject({ name: "AIError", kind: "invalid_output" });
    await expect(tailorResume(base(scripted(empty()).provider))).rejects.toThrow(/no experience bullets/i);
  });

  it("a resume whose roles all have no bullets is the same error", async () => {
    const doc = plannedPage();
    doc.experience.forEach((e) => (e.bullets = []));
    (doc.projects ?? []).forEach((e) => (e.bullets = []));
    await expect(tailorResume(base(scripted(doc).provider))).rejects.toMatchObject({ kind: "invalid_output" });
  });

  it("one role with no bullets, or empty skills and leadership, still gives a resume (nothing crashes)", async () => {
    const doc = plannedPage();
    doc.experience[doc.experience.length - 1].bullets = [];
    doc.skills = [];
    doc.leadership = [];
    doc.education = [];
    const out = await tailorResume(base(scripted(doc).provider));
    expect(out.result.doc.experience.length).toBe(doc.experience.length);
    // The skills the job names are put back by code even when the model left Skills empty.
    expect(out.result.doc.skills.flatMap((l) => l.items).length).toBeGreaterThan(0);
  });

  it("the model renaming a role's title, company dates or location is corrected from her master profile", async () => {
    const doc = plannedPage();
    const real = { ...doc.experience[0] };
    doc.experience[0] = { ...real, title: "Principal Architect", dates: "Jan 2010 - Dec 2012", location: "Paris, France" };
    const out = await tailorResume(base(scripted(doc).provider));
    const fixed = out.result.doc.experience[0];
    expect(fixed.dates).toBe(real.dates);
    expect(fixed.location).toBe(real.location);
    // A title that isn't hers is never kept silently: it is blocked until she decides.
    expect(out.result.flags.some((f) => f.severity === "block" && f.target.section === "experience" && f.target.entry === 0)).toBe(true);
  });

  it("a company that isn't in her experience is flagged, never silently kept", async () => {
    const doc = plannedPage();
    doc.experience[0] = { ...doc.experience[0], company: "Acme Rockets" };
    const out = await tailorResume(base(scripted(doc).provider));
    expect(out.result.flags.some((f) => f.severity === "block")).toBe(true);
  });
});

describe("page length", () => {
  it("far too many bullets still end on one page, keeping the first (most relevant) bullets", async () => {
    const doc = plannedPage();
    const extra = doc.experience.flatMap((e) => e.bullets);
    doc.experience.forEach((e) => (e.bullets = [...e.bullets, ...extra, ...extra].slice(0, 14)));
    const out = await tailorResume(base(scripted(doc).provider));
    const v = buildVersion({ header, result: out.result, approved: new Set(), measure: estimatePageFill, fitOpts: { focus }, jobSkills, master: DEMO_EXPERIENCE });
    expect(estimatePageFill(v.final)).toBeLessThanOrEqual(FIT_LIMIT);
    expect(v.final.experience[0].bullets[0]).toBe(doc.experience[0].bullets[0]);
    expect(bulletCount(v.final)).toBeLessThan(bulletCount(doc));
  });

  it("too few bullets: the final page is not bigger than the model's, and still one page", async () => {
    const doc = plannedPage({ bulletsPerRole: 1 });
    const out = await tailorResume(base(scripted(doc, doc).provider));
    const v = buildVersion({ header, result: out.result, approved: new Set(), measure: estimatePageFill, fitOpts: { focus }, jobSkills, master: DEMO_EXPERIENCE });
    expect(estimatePageFill(v.final)).toBeLessThanOrEqual(FIT_LIMIT);
    expect(v.final.experience.length).toBe(doc.experience.length);
  });
});

describe("the automatic follow-up never makes things worse", () => {
  it("is skipped when code finds nothing to fix (one call)", async () => {
    const { provider, calls } = scripted(plannedPage());
    const out = await tailorResume(base(provider, { measure: () => 0.965 }));
    expect(out.calls).toBe(1);
    expect(calls).toHaveLength(1);
  });

  it("keeps the first draft when the follow-up comes back with no experience", async () => {
    const short = plannedPage({ bulletsPerRole: 2 });
    const { provider } = scripted(short, { ...plannedPage(), experience: [], projects: [] });
    const out = await tailorResume(base(provider));
    expect(out.result.doc.experience.length).toBe(short.experience.length);
    expect(out.notes).toEqual([]);
  });

  it("keeps the first draft when the follow-up fails in any way but a cancel", async () => {
    for (const err of [new AIError("invalid_output", "bad json"), new AIError("truncated", "cut"), new AIError("rate_limit", "slow down"), new Error("boom")]) {
      const short = plannedPage({ bulletsPerRole: 2 });
      const out = await tailorResume(base(scripted(short, err).provider));
      expect(out.result.doc.experience[0].bullets).toHaveLength(2);
    }
  });
});

describe("cancel and closing the dialog", () => {
  /** A provider whose calls wait until the signal aborts. */
  const hanging = (first?: ResumeDoc) => {
    let n = 0;
    return {
      id: "fake",
      completeJson: async <T,>(o: JsonOptions<T>) => {
        if (n++ === 0 && first) return first as T;
        return new Promise<T>((_, reject) => {
          if (o.signal?.aborted) reject(new AIError("cancelled", "Stopped."));
          o.signal?.addEventListener("abort", () => reject(new AIError("cancelled", "Stopped.")));
        });
      },
    } as unknown as AIProvider;
  };

  beforeEach(async () => {
    await Promise.all([db.applications.clear(), db.tailoredResumes.clear()]);
  });

  it("Cancel while the model writes rejects as cancelled and stores nothing", async () => {
    const appId = await db.applications.add({ ...blankApplication(), company: "Cobalt Payments" });
    const c = new AbortController();
    const run = tailorAndSave(base(hanging(), { signal: c.signal }), { applicationId: appId, header, fitOpts: {} });
    c.abort();
    await expect(run).rejects.toMatchObject({ kind: "cancelled" });
    expect(await getJobResume(appId)).toBeFalsy();
  });

  it("Cancel during the follow-up stops the whole run (the first draft is not stored behind her back)", async () => {
    const appId = await db.applications.add({ ...blankApplication(), company: "Cobalt Payments" });
    const c = new AbortController();
    const run = tailorAndSave(base(hanging(plannedPage({ bulletsPerRole: 2 })), { signal: c.signal }), { applicationId: appId, header, fitOpts: {} });
    await new Promise((r) => setTimeout(r, 20));
    c.abort();
    await expect(run).rejects.toMatchObject({ kind: "cancelled" });
    expect(await getJobResume(appId)).toBeFalsy();
  });

  it("closing the dialog (nobody listens) still stores the finished resume for the job", async () => {
    const appId = await db.applications.add({ ...blankApplication(), company: "Cobalt Payments" });
    // No signal is aborted and nothing awaits on screen: the run's own code saves.
    const { id, saveError } = await tailorAndSave(base(scripted(plannedPage()).provider, { measure: () => 0.965 }), { applicationId: appId, header, fitOpts: { focus } });
    expect(saveError).toBeUndefined();
    expect(id).not.toBeNull();
    expect((await getJobResume(appId))?.stored.final.experience.length).toBeGreaterThan(0);
  });

  it("a save that fails after a good answer still hands back the resume (shown with a plain message)", async () => {
    // No such job row: storing fails, the paid result is not lost.
    const { out, id, saveError } = await tailorAndSave(base(scripted(plannedPage()).provider, { measure: () => 0.965 }), { applicationId: 987654, header, fitOpts: { focus } });
    expect(out.result.doc.experience.length).toBeGreaterThan(0);
    if (id === null) expect(saveError).toBeTruthy();
  });
});
