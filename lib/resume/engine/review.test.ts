import { describe, expect, it } from "vitest";
import { AIError, type AIProvider, type JsonOptions } from "../../ai/provider";
import { skillReadiness } from "../coverage";
import { appendSkillToMaster, appendUsageNote } from "../master/skills";
import { MASTER } from "./__fixtures__/master";
import {
  answerComment,
  buildReviewPrompt,
  codeReviewItems,
  mergeReviewItems,
  parseReview,
  planReviewItems,
  REVIEW_EFFORT,
  reviewResume,
  relocateTarget,
  spotText,
  toTarget,
  unverifiedFacts,
  type PlanContext,
  type RecruiterReview,
} from "./review";
import type { ResumeDoc } from "./schema";
import { buildSystemPrompt } from "./prompt";
import { validateResume } from "./validate";

const doc: ResumeDoc = {
  education: [{ school: "Lakeside University", location: "Austin, TX", degree: "Bachelor of Computer Science", dates: "Sep 2022 - Jun 2026", bullets: [] }],
  experience: [
    {
      title: "Software Engineer Intern",
      company: "Brightloop",
      location: "Austin, TX",
      dates: "May 2026 - Aug 2026",
      bullets: ["Shipped **6 production features** to the checkout and payments platform.", "Wrote unit and contract tests for every feature."],
    },
    {
      title: "Founding Software Engineer",
      company: "Taskwise",
      location: "Remote",
      dates: "Oct 2025 - Present",
      bullets: ["Built a habit tracking platform serving **80+ early users**, cutting planning time by **~35%**."],
    },
  ],
  skills: [
    { category: "Languages", items: ["TypeScript", "Python"] },
    { category: "Testing", items: ["Jest", "React Testing Library", "Prometheus"] },
  ],
  leadership: [],
  meta: { matchedKeywords: [], gaps: [], valuesReflected: [] },
};

const item = (over: Partial<Record<string, unknown>> = {}) => ({
  kind: "weak_bullet",
  priority: "medium",
  title: "Make the testing bullet concrete",
  why: "They want engineers who test their own work.",
  change: "Name Jest and React Testing Library in the testing bullet.",
  section: "experience",
  entry: 0,
  bullet: 1,
  skill: "",
  needsFact: false,
  question: "",
  ...over,
});

const ctx = (over: Partial<PlanContext> = {}): PlanContext => ({
  doc,
  master: MASTER,
  keySkills: ["Jest", "Docker", "Kubernetes"],
  jobSkills: ["Jest", "Docker", "Kubernetes", "Python"],
  isRequired: (s) => ["Jest", "Docker", "Kubernetes"].includes(s),
  ...over,
});

describe("toTarget", () => {
  it("keeps spots the page has and drops ones it doesn't", () => {
    expect(toTarget(doc, "experience", 0, 1)).toEqual({ section: "experience", entry: 0, bullet: 1 });
    expect(toTarget(doc, "experience", 1, -1)).toEqual({ section: "experience", entry: 1 });
    expect(toTarget(doc, "experience", 0, 9)).toEqual({ section: "experience", entry: 0 });
    expect(toTarget(doc, "experience", 7, 0)).toBeUndefined();
    expect(toTarget(doc, "whole", -1, -1)).toBeUndefined();
    expect(toTarget(doc, "nonsense", 0, 0)).toBeUndefined();
    expect(toTarget(doc, "skills", 1, -1)).toEqual({ section: "skills", entry: 1 });
  });
});

describe("parseReview", () => {
  it("keeps valid items, drops broken ones, fixes dashes and sorts by priority", () => {
    const r = parseReview(
      {
        summary: "Strong backend story — but testing is buried.",
        items: [
          item({ priority: "low", title: "Low one" }),
          { kind: "weak_bullet" },
          item({ kind: "made_up", title: "Bad kind" }),
          item({ priority: "high", title: "High one", change: "Lead with the tests — they matter." }),
          item({ title: "", change: "no title" }),
        ],
      },
      doc,
    );
    expect(r.summary).not.toMatch(/[–—]/);
    expect(r.findings.map((f) => f.title)).toEqual(["High one", "Low one"]);
    expect(r.findings[0].change).not.toMatch(/[–—]/);
    expect(r.findings[0].target).toEqual({ section: "experience", entry: 0, bullet: 1 });
  });

  it("treats a question without a change as needing a fact", () => {
    const r = parseReview({ summary: "", items: [item({ change: "", question: "How many users?" })] }, doc);
    expect(r.findings[0].needsFact).toBe(true);
  });

  it("throws invalid_output for a malformed answer", () => {
    expect(() => parseReview({ nope: true }, doc)).toThrow(AIError);
    try {
      parseReview(null, doc);
    } catch (e) {
      expect((e as AIError).kind).toBe("invalid_output");
    }
  });

  it("caps the list", () => {
    const many = Array.from({ length: 20 }, (_, i) => item({ title: `Item ${i}` }));
    expect(parseReview({ summary: "", items: many }, doc).findings).toHaveLength(10);
  });
});

describe("buildReviewPrompt", () => {
  const readiness = skillReadiness(doc, ["Jest", "Docker", "Kubernetes"], MASTER, "Jest TypeScript");
  const p = buildReviewPrompt({ company: "Northwind", role: "Software Engineer", jdText: "We use Jest, Docker and Kubernetes.", doc, readiness });

  it("asks for a recruiter review of the labeled page, with code's counts", () => {
    expect(p).toContain("RECRUITER REVIEW");
    expect(p).toContain("recruiter and hiring manager at Northwind");
    expect(p).toContain("experience[0].bullet[1] Wrote unit and contract tests");
    expect(p).toContain("skills[1] Testing: Jest, React Testing Library, Prometheus");
    expect(p).toMatch(/Not on the page: Docker, Kubernetes/);
    expect(p).toMatch(/Not in the MASTER PROFILE at all: Kubernetes/);
  });

  it("forbids invented facts and asks for a question instead", () => {
    expect(p).toMatch(/only use facts in the MASTER PROFILE/);
    expect(p).toMatch(/set needsFact to true, leave "change" empty/);
    expect(p).toMatch(/Have you used Kubernetes\? If yes, where\?/);
    expect(p).not.toMatch(/[–—]/);
  });
});

describe("reviewResume", () => {
  it("makes one smart call at medium effort with the cached tailoring system prompt", async () => {
    const calls: JsonOptions<unknown>[] = [];
    const provider = {
      id: "fake",
      completeJson: async (o: JsonOptions<unknown>) => {
        calls.push(o);
        return o.parse!({ summary: "ok", items: [item()] });
      },
    } as unknown as AIProvider;
    const readiness = skillReadiness(doc, ["Jest"], MASTER, "Jest");
    const r = (await reviewResume(provider, MASTER, { company: "Northwind", role: "SWE", jdText: "Jest", doc, readiness })) as RecruiterReview;
    expect(calls).toHaveLength(1);
    expect(calls[0].tier).toBe("smart");
    expect(calls[0].effort).toBe(REVIEW_EFFORT);
    expect(calls[0].cacheSystem).toBe(true);
    expect(calls[0].system).toBe(buildSystemPrompt(MASTER));
    expect(r.findings).toHaveLength(1);
  });
});

describe("unverifiedFacts", () => {
  it("finds tools, numbers and claims her experience doesn't have", () => {
    expect(unverifiedFacts("Mention the Kubernetes rollout.", MASTER)).toContain("Kubernetes");
    expect(unverifiedFacts("Say it cut latency by 40%.", MASTER)).toContain("40");
    expect(unverifiedFacts("Say the features were for enterprise clients.", MASTER).length).toBeGreaterThan(0);
  });

  it("passes facts that are in her experience", () => {
    expect(unverifiedFacts("Lead with the 80+ users and the ~35% planning time cut, naming Jest.", MASTER)).toEqual([]);
  });
});

describe("planReviewItems", () => {
  const plan = (over: Partial<Record<string, unknown>>) => planReviewItems(parseReview({ summary: "", items: [item(over)] }, doc), ctx());

  it("turns a change with known facts into a targeted revision", () => {
    const [i] = plan({});
    expect(i.action.type).toBe("revise");
    if (i.action.type !== "revise") return;
    expect(i.action.comment.target).toEqual({ section: "experience", entry: 0, bullet: 1 });
    expect(i.action.comment.note).toMatch(/Use only facts in the MASTER PROFILE/);
    expect(i.where).toBe("Brightloop, bullet 2");
  });

  it("asks about a skill she doesn't have instead of writing it", () => {
    const [i] = plan({ kind: "missing_skill", skill: "Kubernetes", title: "Add Kubernetes", change: "Add Kubernetes to the Brightloop bullets." });
    expect(i.action).toEqual({ type: "ask_skill", skill: "Kubernetes", question: "Have you used Kubernetes? If yes, where?" });
  });

  it("asks when the advice sneaks in an unknown tool or number, even if the model says it needs no fact", () => {
    const [tool] = plan({ change: "Rewrite this bullet around the Terraform pipeline." });
    expect(tool.action.type).toBe("ask_fact");
    const [num] = plan({ change: "Say the tests caught 120 bugs." });
    expect(num.action.type).toBe("ask_fact");
    if (num.action.type === "ask_fact") expect(num.action.question).toMatch(/120/);
  });

  it("uses the model's question when it says a fact is needed", () => {
    const [i] = plan({ kind: "metric", change: "", needsFact: true, question: "How many checkouts a day did the platform handle?" });
    expect(i.action).toMatchObject({ type: "ask_fact", question: "How many checkouts a day did the platform handle?" });
  });

  it("offers a free add for a job skill she has that isn't on the page", () => {
    const [i] = plan({ kind: "missing_skill", skill: "Docker", change: "Add Docker to Skills." });
    expect(i.action).toEqual({ type: "add_skill", skill: "Docker" });
  });
});

describe("codeReviewItems", () => {
  const items = codeReviewItems(ctx());

  it("asks about a required skill not in her experience, adds one she has, and never writes either", () => {
    const k8s = items.find((i) => i.id === "code:ask:kubernetes");
    expect(k8s?.action).toMatchObject({ type: "ask_skill", skill: "Kubernetes" });
    expect(k8s?.priority).toBe("high");
    expect(items.find((i) => i.id === "code:add:docker")?.action).toEqual({ type: "add_skill", skill: "Docker" });
  });

  it("asks to name a key skill shown only in Skills in the role that used it", () => {
    const jest = items.find((i) => i.id === "code:prove:jest");
    expect(jest?.action.type).toBe("revise");
    if (jest?.action.type === "revise") {
      expect(jest.action.comment.target).toEqual({ section: "experience", entry: 0 });
      expect(jest.action.comment.note).toMatch(/Jest/);
    }
  });

  it("asks where she used a key skill no role on the page shows, instead of writing it into one", () => {
    const withGo: ResumeDoc = { ...doc, skills: [{ category: "Languages", items: ["TypeScript", "Python", "Go"] }, doc.skills[1]] };
    const items = codeReviewItems(ctx({ doc: withGo, keySkills: ["Go"], jobSkills: ["Go"], isRequired: () => true }));
    expect(items).toHaveLength(1);
    expect(items[0].action).toEqual({ type: "place_skill", skill: "Go", question: "Where did you use Go?" });
  });

  it("doesn't ask again about a skill she confirmed (it's in her experience now)", () => {
    const master = appendUsageNote(appendSkillToMaster(MASTER, "Kubernetes"), "Kubernetes", "ran the staging cluster", { company: "Taskwise", title: "Founding Software Engineer" });
    const again = codeReviewItems(ctx({ master }));
    expect(again.find((i) => i.id === "code:ask:kubernetes")).toBeUndefined();
    expect(again.find((i) => i.id === "code:add:kubernetes")?.action.type).toBe("add_skill");
  });
});

describe("mergeReviewItems", () => {
  it("keeps one row per skill, with code's action and the model's reason", () => {
    const code = codeReviewItems(ctx());
    const model = planReviewItems(
      parseReview({ summary: "", items: [item({ kind: "missing_skill", skill: "Kubernetes", priority: "high", why: "Every service here runs on it.", change: "" , needsFact: true, question: "Ever used k8s?" }), item({})] }, doc),
      ctx(),
    );
    const merged = mergeReviewItems(code, model);
    const k8s = merged.filter((i) => "skill" in i.action && i.action.skill === "Kubernetes");
    expect(k8s).toHaveLength(1);
    expect(k8s[0].fromCode).toBe(true);
    expect(k8s[0].why).toBe("Every service here runs on it.");
    expect(merged.some((i) => i.title === "Make the testing bullet concrete")).toBe(true);
    expect(merged[0].priority).toBe("high");
  });
});

describe("relocateTarget", () => {
  it("finds a spot again by its text after the page changed", () => {
    const q = spotText(doc, { section: "experience", entry: 0, bullet: 1 });
    expect(q).toBe("Wrote unit and contract tests for every feature.");
    expect(relocateTarget(doc, { section: "experience", entry: 0, bullet: 1 }, q)).toEqual({ section: "experience", entry: 0, bullet: 1 });
    const moved: ResumeDoc = { ...doc, experience: [doc.experience[1], doc.experience[0]] };
    expect(relocateTarget(moved, { section: "experience", entry: 0, bullet: 1 }, q)).toEqual({ section: "experience", entry: 1, bullet: 1 });
    expect(relocateTarget(moved, { section: "experience", entry: 0 }, "Brightloop")).toEqual({ section: "experience", entry: 1 });
    const gone: ResumeDoc = { ...doc, experience: [doc.experience[1]] };
    expect(relocateTarget(gone, { section: "experience", entry: 0, bullet: 1 }, q)).toBeUndefined();
  });
});

describe("decision #6: the review can't put an unverified fact on the page", () => {
  it("a revision that writes a fact from her typed answer is still left out until she keeps it", () => {
    const [q] = planReviewItems(parseReview({ summary: "", items: [item({ kind: "metric", change: "", needsFact: true, question: "How many users?" })] }, doc), ctx());
    const c = answerComment(q, "about 900 users");
    expect(c.note).toContain('"about 900 users"');
    expect(c.target).toEqual({ section: "experience", entry: 0, bullet: 1 });
    // Suppose the revision wrote her answer (and a tool she never mentioned) into the bullet.
    const revised: ResumeDoc = {
      ...doc,
      experience: doc.experience.map((e, i) => (i === 0 ? { ...e, bullets: [e.bullets[0], "Wrote tests for **900 users** on **Kubernetes**."] } : e)),
    };
    const checked = validateResume(revised, MASTER);
    const blocked = checked.flags.filter((f) => f.severity === "block").map((f) => f.message).join(" ");
    expect(blocked).toMatch(/900/);
    expect(blocked).toMatch(/Kubernetes/);
  });
});
