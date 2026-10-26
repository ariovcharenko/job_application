import { describe, expect, it } from "vitest";
import type { AIProvider, JsonOptions } from "../../ai/provider";
import { lintResume } from "../quality/lint";
import { keywordComments, tailorResume } from "./pipeline";
import type { ResumeDoc } from "./schema";

// Fewer second calls: keyword asks are worked out after the backfill with the validator's matcher,
// and a page with only "consider"-level issues is never sent back.

const SMALL = `### Experience
**Software Engineer | Northwind | Remote | Jan 2025 - Present**
- Built billing exports in Python, cutting manual work by half.
- Ran the Ruby on Rails admin tool for refunds, handling 300 tickets a week.

### Skills
- **Languages:** Python, Ruby
`;

const small = (bullets: string[]): ResumeDoc => ({
  education: [],
  experience: [{ title: "Software Engineer", company: "Northwind", location: "Remote", dates: "Jan 2025 - Present", bullets }],
  skills: [{ category: "Languages", items: ["Python", "Ruby"] }],
  leadership: [],
  meta: { matchedKeywords: [], gaps: [], valuesReflected: [] },
});

function fake(first: ResumeDoc) {
  const calls: JsonOptions<unknown>[] = [];
  const provider = {
    completeJson: async <T,>(o: JsonOptions<T>) => {
      calls.push(o as JsonOptions<unknown>);
      return (calls.length === 1 ? first : { ...first, changes: [] }) as T;
    },
  } as unknown as AIProvider;
  return { provider, calls };
}

const go = (provider: AIProvider) =>
  tailorResume({ provider, master: SMALL, company: "Acme", jdText: "job", jobSkills: ["Ruby", "Python"], requiredSkills: ["Ruby"], measure: () => 0.965 });

describe("fewer second calls", () => {
  it("asks for keywords after the backfill: a restored source bullet that names the skill ends the ask", async () => {
    const page = small(["Built billing exports in **Python**, cutting manual work by half."]);
    // On the model's page nothing names Ruby, and the role's own text does: an ask would be made...
    expect(keywordComments(page, SMALL, ["Ruby"])).toHaveLength(1);
    // ...but the backfill restores the Ruby on Rails bullet first, so no second call is needed.
    const { provider, calls } = fake(page);
    const out = await go(provider);
    expect(calls).toHaveLength(1);
    expect(out.calls).toBe(1);
    expect(out.result.doc.experience[0].bullets.some((b) => /Ruby on Rails/.test(b.replace(/\*\*/g, "")))).toBe(true);
  });

  it("uses the validator's matcher: 'Ruby on Rails' on the page already names Ruby", () => {
    const page = small(["Ran the **Ruby on Rails** admin tool for refunds, handling **300** tickets a week."]);
    expect(keywordComments(page, SMALL, ["Ruby"])).toEqual([]);
  });

  it("makes no second call when only 'consider'-level issues remain", async () => {
    const page = small(["Built **Python** exports.", "Ran the **Ruby on Rails** admin tool for refunds, handling **300** tickets a week."]);
    // A thin bullet is a judgment call ('consider'), never sent back.
    expect(lintResume(page, {}).filter((i) => i.severity === "fix")).toEqual([]);
    expect(lintResume(page, {}).some((i) => i.severity === "consider")).toBe(true);
    const { provider, calls } = fake(page);
    const out = await go(provider);
    expect(calls).toHaveLength(1);
    expect(out.calls).toBe(1);
  });
});
