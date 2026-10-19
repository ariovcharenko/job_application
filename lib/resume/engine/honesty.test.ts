import { beforeEach, describe, expect, it } from "vitest";
import { MASTER } from "./__fixtures__/master";
import { MIN_GAP_MS, resetJevThrottle, type JevOptions } from "../../ai/jev";
import { checkWording, QUESTIONS_PER_REQUEST, wordingCandidates, wordingQuestion, WORDING_MIN_CONFIDENCE, WORDING_OPTIONS } from "./honesty";
import { carryApprovals } from "./revise";
import { parseStoredResume, withPreviousVersion } from "./save";
import type { ResumeDoc } from "./schema";
import { applyApprovals, validateResume, wordingFlags, wordingMessage, withWording } from "./validate";

function doc(bullets: string[], taskwise: string[] = []): ResumeDoc {
  return {
    education: [],
    experience: [
      { title: "Software Engineer Intern", company: "Brightloop", location: "Austin, TX", dates: "May 2026 - Aug 2026", bullets },
      ...(taskwise.length ? [{ title: "Founding Software Engineer", company: "Taskwise", location: "Remote", dates: "Oct 2025 - Present", bullets: taskwise }] : []),
    ],
    skills: [],
    leadership: [],
    meta: { matchedKeywords: [], gaps: [], valuesReflected: [] },
  };
}

const VERBATIM = "Shipped 6 production features to Brightloop's checkout and payments platform.";
const INFLATED = "Led the redesign of Brightloop's checkout and payments architecture";

/** A fake fetch that records requests and answers every question with `answer`. */
function fakeFetch(answer: (id: string, instructions: string) => object | null, log: { questions: Record<string, { instructions: string; criteria: Record<string, string> }>; key?: string }[] = []) {
  const f = (async (_url: string, init: { body: string }) => {
    const body = JSON.parse(init.body);
    log.push({ questions: body.questions, key: body.key });
    const answers: Record<string, object> = {};
    for (const [id, q] of Object.entries(body.questions as Record<string, { instructions: string }>)) {
      const a = answer(id, q.instructions);
      if (a) answers[id] = a;
    }
    return new Response(JSON.stringify({ model: "jev", answers }), { status: 200 });
  }) as unknown as typeof fetch;
  return f;
}

const choiceAnswer = (choice: string, confidence: number) => ({ type: "choice", choice, confidence, probabilities: {} });
const fast = (fetch: typeof globalThis.fetch): JevOptions => ({ fetch, sleep: async () => {}, now: () => 0 });

beforeEach(() => resetJevThrottle());

describe("wordingCandidates", () => {
  it("skips a bullet that is a source line verbatim, or nearly", () => {
    expect(wordingCandidates(doc([VERBATIM, `**Shipped 6 production features** to Brightloop's checkout and payments platform`]), MASTER)).toEqual([]);
  });

  it("maps a changed bullet to the source lines of its own role only", () => {
    const c = wordingCandidates(doc([INFLATED], ["Built a habit tracking platform for 80+ early users"]), MASTER);
    const brightloop = c.find((x) => x.text.startsWith("Led the redesign"))!;
    expect(brightloop.lines[0]).toBe(VERBATIM);
    expect(brightloop.lines.join("\n")).not.toMatch(/habit tracking/);
    const taskwise = c.find((x) => x.text.startsWith("Built a habit"))!;
    expect(taskwise.lines.join("\n")).toMatch(/habit tracking/);
    expect(taskwise.lines.join("\n")).not.toMatch(/Brightloop/);
  });

  it("puts the most changed bullet first and ignores an unknown role", () => {
    const d = doc(["Shipped 6 production features to the checkout platform at Brightloop", "Spearheaded company wide strategy"]);
    d.experience.push({ title: "X", company: "Nowhere Inc", location: "", dates: "2020", bullets: ["Totally unrelated claim"] });
    const c = wordingCandidates(d, MASTER);
    expect(c[0].text).toMatch(/Spearheaded/);
    expect(c.some((x) => /unrelated/.test(x.text))).toBe(false);
  });
});

describe("wordingQuestion", () => {
  it("lists the safe answer first and states source and bullet", () => {
    const q = wordingQuestion(wordingCandidates(doc([INFLATED]), MASTER)[0]);
    expect(Object.keys(WORDING_OPTIONS)).toEqual(["supported", "overstated", "unsupported"]);
    expect(q.type === "choice" && Object.keys(q.criteria)).toEqual(["supported", "overstated", "unsupported"]);
    expect(q.instructions).toContain(`Source:\n${VERBATIM}`);
    expect(q.instructions).toContain(`Bullet: ${INFLATED}`);
  });
});

describe("checkWording", () => {
  it("does nothing and makes no call without a key", async () => {
    let calls = 0;
    const f = (async () => {
      calls++;
      return new Response("{}");
    }) as unknown as typeof fetch;
    expect(await checkWording(undefined, doc([INFLATED]), MASTER, fast(f))).toEqual([]);
    expect(await checkWording("  ", doc([INFLATED]), MASTER, fast(f))).toEqual([]);
    expect(calls).toBe(0);
  });

  it("sends nothing when every bullet is verbatim", async () => {
    const log: { questions: Record<string, never> }[] = [];
    const out = await checkWording("k", doc([VERBATIM]), MASTER, fast(fakeFetch(() => null, log as never)));
    expect(out).toEqual([]);
    expect(log).toHaveLength(0);
  });

  it("flags overstated and unsupported at or above the threshold, not below or when supported", async () => {
    const bullets = ["Led the redesign of checkout", "Owned payments strategy", "Wrote Jest tests for checkout", "Managed the Brightloop team"];
    const answers = [choiceAnswer("overstated", WORDING_MIN_CONFIDENCE), choiceAnswer("unsupported", 0.95), choiceAnswer("supported", 0.99), choiceAnswer("overstated", 0.69)];
    const cands = wordingCandidates(doc(bullets), MASTER);
    const order = new Map(cands.map((c, i) => [`b${i}`, c.text]));
    const byText = new Map(bullets.map((b, i) => [b, answers[i]]));
    const hits = await checkWording("k", doc(bullets), MASTER, fast(fakeFetch((id) => byText.get(order.get(id)!) ?? null)));
    expect(hits.map((h) => h.text).sort()).toEqual(["Led the redesign of checkout", "Owned payments strategy"].sort());
    expect(hits[0].source.length).toBeGreaterThan(0);
  });

  it("chunks at 20 questions per request, one after another with the 2s gap", async () => {
    const bullets = Array.from({ length: 25 }, (_, i) => `Pioneered initiative number ${i} across the whole company`);
    const log: { questions: Record<string, never> }[] = [];
    const sleeps: number[] = [];
    let t = 0;
    const opts: JevOptions = { fetch: fakeFetch(() => choiceAnswer("supported", 1), log as never), sleep: async (ms) => void sleeps.push(ms), now: () => t };
    await checkWording("k", doc(bullets), MASTER, opts);
    expect(log.map((l) => Object.keys(l.questions).length)).toEqual([QUESTIONS_PER_REQUEST, 5]);
    expect(sleeps).toEqual([MIN_GAP_MS]);
  });

  it("returns no flags and does not throw on a Jev error or a cancel", async () => {
    const bad = (async () => new Response(JSON.stringify({ error: { kind: "auth", message: "no" } }), { status: 401 })) as unknown as typeof fetch;
    expect(await checkWording("k", doc([INFLATED]), MASTER, fast(bad))).toEqual([]);
    const boom = (async () => {
      throw new Error("offline");
    }) as unknown as typeof fetch;
    expect(await checkWording("k", doc([INFLATED]), MASTER, fast(boom))).toEqual([]);
    const c = new AbortController();
    c.abort();
    expect(await checkWording("k", doc([INFLATED]), MASTER, { ...fast(fakeFetch(() => choiceAnswer("overstated", 1))), signal: c.signal })).toEqual([]);
  });

  it("drops the whole result when a later chunk fails", async () => {
    const bullets = Array.from({ length: 25 }, (_, i) => `Pioneered initiative number ${i} across the whole company`);
    let n = 0;
    const f = (async () => {
      n++;
      if (n >= 2) return new Response(JSON.stringify({ error: { kind: "overloaded" } }), { status: 500 });
      const body = { model: "j", answers: Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`b${i}`, choiceAnswer("overstated", 1)])) };
      return new Response(JSON.stringify(body), { status: 200 });
    }) as unknown as typeof fetch;
    expect(await checkWording("k", doc(bullets), MASTER, fast(f))).toEqual([]);
  });
});

describe("wording flags", () => {
  const hit = { text: INFLATED, source: VERBATIM };

  it("are look-at notes on the matching bullet, in the same position", () => {
    const flags = wordingFlags(doc(["Other bullet", `**Led** the redesign of Brightloop's checkout and payments architecture`]), [hit]);
    expect(flags).toHaveLength(1);
    expect(flags[0]).toMatchObject({ kind: "wording", severity: "note", target: { section: "experience", entry: 0, bullet: 1 } });
    expect(flags[0].message).toBe(wordingMessage(VERBATIM));
    expect(flags[0].message).toBe(`This may claim more than Your experience says. Source: ${VERBATIM.replace(/\.$/, "")}.`);
  });

  it("do not remove the bullet from the download", () => {
    const d = doc([INFLATED]);
    const r = withWording({ doc: d, flags: [], fixes: [] }, [hit]);
    // not approved: a note never drops anything
    expect(r.flags).toHaveLength(1);
    expect(applyApprovals(d, r.flags, new Set()).experience[0].bullets).toEqual([INFLATED]);
  });

  it("validateResume is unchanged without hits, and keeps hits for unchanged bullets across re-checks", () => {
    const d = doc([INFLATED]);
    const plainRun = validateResume(d, MASTER);
    expect(plainRun.flags.some((f) => f.kind === "wording")).toBe(false);
    const withHit = validateResume(d, MASTER, { wording: [hit] });
    expect(withHit.flags.filter((f) => f.kind === "wording")).toHaveLength(1);
    expect(withHit.flags.filter((f) => f.kind !== "wording")).toEqual(plainRun.flags);
    const edited = validateResume(doc(["A different bullet"]), MASTER, { wording: [hit] });
    expect(edited.flags.some((f) => f.kind === "wording")).toBe(false);
  });

  it("keep their dismissal when the same note comes back after an update", () => {
    const first = withWording(validateResume(doc([INFLATED]), MASTER), [hit]);
    const note = first.flags.find((f) => f.kind === "wording")!;
    const next = withWording(validateResume(doc(["Added line", INFLATED]), MASTER), [hit]);
    const carried = carryApprovals(first.flags, new Set([note.id]), next.flags);
    const nextNote = next.flags.find((f) => f.kind === "wording")!;
    expect(carried.has(nextNote.id)).toBe(true);
  });

  it("are stored with the resume and read back; older rows have none", () => {
    const d = doc([INFLATED]);
    const stored = withPreviousVersion(null, { v: 2, doc: d, approved: [], final: d, wording: [hit] }, 1);
    expect(parseStoredResume(JSON.stringify(stored))?.wording).toEqual([hit]);
    expect(parseStoredResume(JSON.stringify({ v: 2, doc: d, approved: [], final: d }))?.wording).toBeUndefined();
    // a version saved without hits keeps them; an empty list clears them
    expect(withPreviousVersion(stored, { v: 2, doc: d, approved: [], final: d }, 2).wording).toEqual([hit]);
    expect(withPreviousVersion(stored, { v: 2, doc: d, approved: [], final: d, wording: [] }, 2).wording).toBeUndefined();
  });
});
