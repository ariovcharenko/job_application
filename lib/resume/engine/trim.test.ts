import { describe, expect, it } from "vitest";
import type { ResumeDoc } from "./schema";
import { fitResume, fitToPage, toPoolTarget } from "./trim";

// A fake page: every piece costs whole lines, a bullet one line per started 100 characters.
// fill = lines / capacity, so each test can say exactly how much room there is.
const bulletLines = (b: string) => Math.max(1, Math.ceil(b.replace(/\*\*/g, "").length / 100));
function lines(d: ResumeDoc): number {
  let n = 2; // name + contact
  if (d.education.length) n += 1 + d.education.reduce((s, e) => s + 2 + e.bullets.reduce((t, b) => t + bulletLines(b), 0), 0);
  if (d.experience.length) n += 1 + d.experience.reduce((s, e) => s + 2 + e.bullets.reduce((t, b) => t + bulletLines(b), 0), 0);
  if (d.skills.length) n += 1 + d.skills.length;
  if (d.leadership.length) n += 1 + d.leadership.length;
  return n;
}
const page = (capacity: number) => (d: ResumeDoc) => lines(d) / capacity;
const exact = { limit: 1, fillTarget: 0.92 };

const exp = (company: string, bullets: string[]) => ({ title: "SWE", company, location: "", dates: "", bullets });
const doc = (over: Partial<ResumeDoc>): ResumeDoc => ({
  education: [],
  experience: [],
  skills: [],
  leadership: [],
  meta: { matchedKeywords: [], gaps: [], valuesReflected: [] },
  ...over,
});
const long = (s: string) => s.padEnd(150, " x"); // two lines
const veryLong = (s: string) => s.padEnd(250, " x"); // three lines

describe("fitToPage: trimming", () => {
  it("leaves a pool that already fits alone and reports how full the page is", () => {
    const d = doc({ experience: [exp("A", ["a", "b", "c"])] }); // 2 + 1 + 2 + 3 = 8 lines
    const r = fitToPage(d, page(8), exact);
    expect(r.removed).toEqual([]);
    expect(r.fits).toBe(true);
    expect(r.fill).toBe(1);
    expect(r.underfilled).toBe(false);
  });

  it("says the page is underfilled when the whole pool is on it and it still ends early", () => {
    const r = fitToPage(doc({ experience: [exp("A", ["a", "b"])] }), page(10), exact); // 7 of 10 lines
    expect(r.fits).toBe(true);
    expect(r.fill).toBeCloseTo(0.7);
    expect(r.underfilled).toBe(true);
  });

  it("drops leadership before any experience bullet", () => {
    const d = doc({ experience: [exp("A", ["a", "b", "c"])], leadership: [{ role: "Track", dates: "" }] }); // 10 lines
    const r = fitToPage(d, page(9), exact);
    expect(r.removed).toEqual(["Leadership: Track"]);
    expect(r.doc.experience[0].bullets).toHaveLength(3);
  });

  it("cuts the least relevant bullet, not the last or the metric-free one", () => {
    const jobHasJest = (t: string) => (/Jest/.test(t) ? 1 : 0);
    const d = doc({
      experience: [
        exp("A", ["Built **React** dashboards for **6 teams**", "Designed REST endpoints", "Wrote **Jest** unit and component tests", "Refactored legacy code"]),
      ],
    }); // 9 lines
    const r = fitToPage(d, page(7), { ...exact, relevance: jobHasJest });
    expect(r.doc.experience[0].bullets).toEqual(["Built **React** dashboards for **6 teams**", "Wrote **Jest** unit and component tests"]);
    expect(r.removed).toEqual(['A: "Refactored legacy code"', 'A: "Designed REST endpoints"']);
  });

  it("doesn't mistake S3 or k6 for a metric", () => {
    const d = doc({ experience: [exp("A", ["Built the API", "Stored uploads in **S3**, load-tested with **k6**", "Shipped **6 production features**"])] });
    const r = fitToPage(d, page(7), exact);
    expect(r.doc.experience[0].bullets).toEqual(["Built the API", "Shipped **6 production features**"]);
  });

  it("takes bullets from the role furthest above its aim first, so the top role keeps the most", () => {
    const d = doc({
      experience: [exp("A", ["a1", "a2", "a3", "a4", "a5", "a6", "a7"]), exp("B", ["b1", "b2", "b3", "b4"]), exp("C", ["c1", "c2", "c3"])],
    }); // 2 + 1 + 9 + 6 + 5 = 23 lines
    const two = fitToPage(d, page(21), exact);
    expect(two.doc.experience.map((e) => e.bullets.length)).toEqual([5, 4, 3]);
    const three = fitToPage(d, page(20), exact);
    // Then every role is at its aim: the weakest bullet goes, ties to the later role.
    expect(three.doc.experience.map((e) => e.bullets.length)).toEqual([5, 4, 2]);
  });

  it("drops a fourth role whole (never the most recent) before squeezing roles to two bullets", () => {
    const d = doc({ experience: ["A", "B", "C", "D"].map((c) => exp(c, [`${c}1`, `${c}2`, `${c}3`])) }); // 23 lines
    const r = fitToPage(d, page(20), exact);
    expect(r.doc.experience.map((e) => e.company)).toEqual(["A", "B", "C"]);
    expect(r.removed).toEqual(["Role: SWE, D"]);
    expect(r.fill).toBe(0.9);
    expect(r.underfilled).toBe(true);
  });

  it("never goes below two bullets per role, then trims education and skills lines, and says when it can't fit", () => {
    const d = doc({
      education: [{ school: "Lakeside University", location: "", degree: "", dates: "", bullets: ["Coursework", "Honors"] }],
      experience: [exp("A", ["a1", "a2", "a3", "a4"]), exp("B", ["b1", "b2", "b3"])],
      skills: Array.from({ length: 7 }, (_, i) => ({ category: `C${i}`, items: ["x"] })),
    });
    const r = fitToPage(d, page(5), exact);
    expect(r.fits).toBe(false);
    expect(r.doc.experience.map((e) => e.bullets.length)).toEqual([2, 2]);
    expect(r.doc.education[0].bullets).toEqual([]);
    expect(r.doc.skills).toHaveLength(5);
    expect(r.underfilled).toBe(false);
  });
});

describe("fitToPage: filling", () => {
  it("puts back a smaller cut bullet when a later, bigger cut freed room", () => {
    const big = long("Big bullet");
    const d = doc({ experience: [exp("A", ["a", "b", big, "d"])] }); // 2 + 1 + 2 + 5 = 10 lines
    const r = fitToPage(d, page(8), exact);
    expect(r.doc.experience[0].bullets).toEqual(["a", "b", "d"]);
    expect(r.removed).toEqual([`A: "${big}"`]);
    expect(r.restored).toEqual(['A: "d"']);
    expect(r.fill).toBe(1);
  });

  it("brings leadership back when experience cuts left room for it", () => {
    const huge = veryLong("Huge bullet");
    const d = doc({ experience: [exp("A", ["a", "b", huge])], leadership: [{ role: "Track", dates: "" }] }); // 2+1+2+5+2 = 12
    const r = fitToPage(d, page(9), exact);
    expect(r.doc.leadership).toHaveLength(1);
    expect(r.doc.experience[0].bullets).toEqual(["a", "b"]);
    expect(r.restored).toEqual(["Leadership: Track"]);
  });

  it("doesn't count a bullet of a role that stays off as put back", () => {
    const hasReact = (t: string) => (/React/.test(t) ? 1 : 0);
    const d = doc({
      experience: [
        ...["A", "B", "C"].map((c) => exp(c, [`${c} React 1`, `${c} React 2`, `${c} React 3`])),
        exp("D", ["d1", "d2", "d3", "d4"]),
      ],
    }); // 2 + 1 + 15 + 6 = 24 lines
    const r = fitToPage(d, page(20), { ...exact, relevance: hasReact });
    expect(r.doc.experience.map((e) => e.company)).toEqual(["A", "B", "C"]);
    expect(r.restored).toEqual([]);
    expect(r.removed).toEqual(['D: "d4"', "Role: SWE, D"]);
  });
});

describe("toPoolTarget", () => {
  it("maps a spot on the page to the same spot in the pool", () => {
    const d = doc({
      experience: [exp("A", ["a", "b", long("Big"), "d"])],
      skills: [{ category: "L", items: ["x"] }],
      leadership: [{ role: "Track", dates: "" }],
    });
    const r = fitToPage(d, page(10), exact);
    // Leadership (2 lines) and the big bullet are off; "d" is shown as bullet 2 but is pool bullet 3.
    expect(r.doc.experience[0].bullets).toEqual(["a", "b", "d"]);
    expect(toPoolTarget(r.map, { section: "experience", entry: 0, bullet: 2 })).toEqual({ section: "experience", entry: 0, bullet: 3 });
    expect(toPoolTarget(r.map, { section: "experience", entry: 0 })).toEqual({ section: "experience", entry: 0 });
    expect(toPoolTarget(r.map, { section: "skills", entry: 0 })).toEqual({ section: "skills", entry: 0 });
    expect(toPoolTarget(r.map, { section: "leadership", entry: 0 })).toBeNull();
    expect(toPoolTarget(r.map, { section: "experience", entry: 0, bullet: 3 })).toBeNull();
  });
});

describe("fitResume: her fill loop", () => {
  // Height scales with the body font (relative to 10pt) and the spacing multiple; projects count too.
  const scaled = (capacity: number) => (d: ResumeDoc) => {
    const l = d.layout ?? { body: 10, spacing: 1 };
    const proj = d.projects?.length ? 1 + d.projects.reduce((s, e) => s + 2 + e.bullets.length, 0) : 0;
    return ((lines(d) + proj) * (l.body / 10) * l.spacing) / capacity;
  };
  const opts = { limit: 0.99, fillTarget: 0.93 };

  it("raises the font first, then the spacing, never past 11pt and 1.15", () => {
    const d = doc({ experience: [exp("A", ["a", "b", "c", "d", "e"])] }); // 10 lines
    const r = fitResume(d, scaled(12), opts);
    expect(r.layout.body).toBeGreaterThan(10);
    expect(r.layout.body).toBeLessThanOrEqual(11);
    expect(r.fill).toBeGreaterThanOrEqual(0.93);
    expect(r.fill).toBeLessThanOrEqual(0.99);
    expect(r.doc.layout).toEqual(r.layout);

    const tiny = fitResume(doc({ experience: [exp("A", ["a"])] }), scaled(40), opts);
    expect(tiny.layout).toEqual({ body: 11, spacing: 1.15 });
    expect(tiny.underfilled).toBe(true);
  });

  it("over the page at 10pt: trims the least relevant content and never shrinks below 10pt", () => {
    const d = doc({ experience: [exp("A", ["a", "b", "c", "d", "e", "f"]), exp("B", ["g", "h", "i", "j"])], leadership: [{ role: "Club", dates: "" }] });
    const r = fitResume(d, scaled(12), opts);
    expect(r.fits).toBe(true);
    expect(r.layout.body).toBeGreaterThanOrEqual(10);
    expect(r.removed[0]).toMatch(/Leadership/);
  });

  it("puts back no more than 5 bullets in a role when restoring", () => {
    // Leadership is cut first and frees a lot; restoring then may only refill role A up to 5.
    const d = doc({ experience: [exp("A", ["a", "b", "c", "d", "e", "f", "g", "h"])], leadership: [{ role: veryLong("Club"), dates: "" }] });
    const measure = (x: ResumeDoc) => (x.experience[0].bullets.length + (x.leadership.length ? 6 : 0)) / 7;
    const r = fitToPage(d, measure, { limit: 1, fillTarget: 0.93, maxBulletsPerRole: 5 });
    expect(r.doc.experience[0].bullets.length).toBeLessThanOrEqual(7);
    const capped = fitToPage(doc({ experience: [exp("A", ["a", "b", "c", "d", "e", "f", "g", "h"])] }), (x) => (x.experience[0].bullets.length > 2 ? 2 : 0.5), { limit: 1, maxBulletsPerRole: 5 });
    expect(capped.doc.experience[0].bullets.length).toBeLessThanOrEqual(5);
  });

  it("shows at most 2 bullets per project", () => {
    const d = doc({ experience: [exp("A", ["a", "b"])], projects: [exp("P", ["1", "2", "3", "4"])] });
    const r = fitResume(d, scaled(30), opts);
    expect(r.doc.projects?.[0].bullets).toEqual(["1", "2"]);
  });
});
