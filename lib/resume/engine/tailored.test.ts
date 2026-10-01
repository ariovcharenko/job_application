import { describe, expect, it } from "vitest";
import { buildJobFocus } from "./focus";
import type { ResumeDoc } from "./schema";
import { explainTailoring, listWords } from "./tailored";

const focus = buildJobFocus({
  role: "Software Engineer, Payments",
  jdText: "About the role\nBuild payout APIs in Go and PostgreSQL.",
  must: ["Go", "PostgreSQL"],
  nice: ["Terraform"],
});

const doc: ResumeDoc = {
  education: [],
  experience: [
    { title: "Frontend Intern", company: "Web Co", location: "", dates: "Jun 2025 - Sep 2025", bullets: ["Styled pages"] },
    { title: "Software Engineer Intern", company: "Pay Co", location: "", dates: "Jun 2024 - Sep 2024", bullets: ["Built payouts in **Go**", "Tuned **PostgreSQL**"] },
  ],
  skills: [
    { category: "Tools", items: ["Git"] },
    { category: "Languages", items: ["Go", "SQL"] },
    { category: "Cloud", items: ["Terraform", "Docker"] },
  ],
  leadership: [],
  meta: { matchedKeywords: [], gaps: [], valuesReflected: [] },
};

describe("listWords", () => {
  it("joins like a sentence", () => {
    expect(listWords([])).toBe("");
    expect(listWords(["a"])).toBe("a");
    expect(listWords(["a", "b"])).toBe("a and b");
    expect(listWords(["a", "b", "c"])).toBe("a, b and c");
  });
});

describe("explainTailoring", () => {
  it("says how the job reads, which role matches best, what the skills lead with and what was left off", () => {
    const lines = explainTailoring(
      focus,
      { doc, leftOffEntries: [{ kind: "role", title: "Teaching Assistant", company: "School" }, { kind: "project", title: "Personal project", company: "Ledger" }] },
      { copied: 2 },
    );
    expect(lines).toEqual([
      "Read as a Software Engineering job focused on payments and backend services.",
      "Your Pay Co role is the closest match and gets 2 bullets, showing Go and PostgreSQL.",
      // SQL isn't PostgreSQL (the job asks for the specific database), so it isn't named.
      "Skills ordered for Go and Terraform first.",
      "Left off your Teaching Assistant role and the Ledger project to fit one page.",
      "2 bullets are your own lines from Your experience, copied word for word to fill the page.",
    ]);
  });

  it("leaves out lines it has nothing true to say for", () => {
    const lines = explainTailoring(buildJobFocus({ role: "Something", jdText: "", must: [] }), { doc, leftOffEntries: [] });
    expect(lines.some((l) => /Left off|copied|Skills ordered|Read as/.test(l))).toBe(false);
  });
});
