import { beforeEach, describe, expect, it } from "vitest";
import { AIError, type AIProvider, type JsonOptions } from "../../ai/provider";
import { db } from "../../db";
import { blankApplication } from "../../tracker/blank";
import { MASTER } from "./__fixtures__/master";
import { buildVersion, tailorAndSave } from "./persist";
import { getJobResume } from "./save";
import type { ResumeDoc } from "./schema";
import { validateResume } from "./validate";

// Closing the tailoring dialog mid-run unmounts the panel, so nothing in React is left to save the
// answer. tailorAndSave stores it in the run's own async path; these tests run it with no
// component at all, like a dialog that has already closed.

const header = { name: "Alex Rivera", location: "Austin, TX", links: [] };
const page: ResumeDoc = {
  education: [{ school: "Lakeside University", location: "Austin, TX", degree: "Bachelor of Computer Science, Minor in Data Science", dates: "Sep 2022 - Jun 2026", bullets: [] }],
  experience: [
    {
      title: "Software Engineer Intern",
      company: "Brightloop",
      location: "Austin, TX",
      dates: "May 2026 - Aug 2026",
      bullets: ["Shipped **6 production features** to the checkout and payments platform.", "Wrote unit, component and contract tests for every feature with **Jest** and **React Testing Library**."],
    },
  ],
  skills: [{ category: "Languages", items: ["TypeScript", "JavaScript", "Python"] }],
  leadership: [],
  meta: { matchedKeywords: [], gaps: [], valuesReflected: [] },
};

/** A fake model that answers after `release()` is called, or rejects when the signal aborts. */
function slowProvider() {
  let release: () => void = () => {};
  const gate = new Promise<void>((r) => (release = r));
  const provider = {
    id: "fake",
    completeJson: async (o: JsonOptions<unknown>) => {
      await Promise.race([
        gate,
        new Promise((_, reject) => o.signal?.addEventListener("abort", () => reject(new AIError("cancelled", "Stopped.")))),
      ]);
      return o.parse!({ ...page, changes: [] });
    },
  } as unknown as AIProvider;
  return { provider, release };
}

const input = (provider: AIProvider, signal?: AbortSignal) => ({
  provider,
  master: MASTER,
  company: "Northwind",
  jdText: "We use Jest.",
  jobSkills: ["Jest"],
  measure: () => 0.95,
  signal,
});

beforeEach(async () => {
  await Promise.all([db.applications.clear(), db.tailoredResumes.clear()]);
});

describe("tailorAndSave", () => {
  it("stores the result for the job even though no screen is listening any more", async () => {
    const appId = await db.applications.add({ ...blankApplication(), company: "Northwind" });
    const { provider, release } = slowProvider();
    const run = tailorAndSave(input(provider), { applicationId: appId, header, fitOpts: {} });
    // The dialog closes here: nothing awaits `run` on screen. The answer then arrives.
    release();
    const { id } = await run;
    const row = await getJobResume(appId);
    expect(row?.id).toBe(id);
    expect(row?.stored.final.experience[0].company).toBe("Brightloop");
    expect((await db.applications.get(appId))?.tailoredResumeId).toBe(id);
  });

  it("stores nothing when she cancels", async () => {
    const appId = await db.applications.add({ ...blankApplication(), company: "Northwind" });
    const { provider } = slowProvider();
    const controller = new AbortController();
    const run = tailorAndSave(input(provider, controller.signal), { applicationId: appId, header, fitOpts: {} });
    controller.abort();
    await expect(run).rejects.toMatchObject({ kind: "cancelled" });
    expect(await getJobResume(appId)).toBeNull();
  });
});

describe("buildVersion", () => {
  it("leaves out a blocked line she hasn't kept, and keeps it once she has", () => {
    const withInvented: ResumeDoc = { ...page, experience: [{ ...page.experience[0], bullets: [...page.experience[0].bullets, "Ran **Kubernetes** clusters."] }] };
    const result = validateResume(withInvented, MASTER);
    const block = result.flags.find((f) => f.severity === "block")!;
    expect(block).toBeDefined();
    const base = { header, result, measure: () => 0.95, fitOpts: {}, jobSkills: ["Jest"], master: MASTER };
    const left = buildVersion({ ...base, approved: new Set() });
    expect(left.final.experience[0].bullets.join(" ")).not.toMatch(/Kubernetes/);
    const kept = buildVersion({ ...base, approved: new Set([block.id]) });
    expect(kept.final.experience[0].bullets.join(" ")).toMatch(/Kubernetes/);
    expect(kept.stored.approved).toEqual([block.message]);
  });
});
