import { describe, expect, it } from "vitest";
import { blankApplication } from "./blank";
import { mergeReloaded } from "./merge";

describe("mergeReloaded (Paste and re-check with unsaved Details edits)", () => {
  const base = { ...blankApplication(1), id: 1, company: "Brightloop", role: "Engineer", jdText: "shell", fitBreakdown: "old", notes: "" };

  it("keeps her unsaved edits and takes the new analysis", () => {
    const mine = { ...base, notes: "Referral from Alex", salary: "$120k" };
    const stored = { ...base, jdText: "Full posting", fitBreakdown: "new", fitScore: 80, workMode: "Remote" as const };
    const out = mergeReloaded(mine, base, stored);
    expect(out).toMatchObject({ notes: "Referral from Alex", salary: "$120k", jdText: "Full posting", fitBreakdown: "new", fitScore: 80, workMode: "Remote" });
  });

  it("the re-check's job description wins over one typed in Details", () => {
    const mine = { ...base, jdText: "typed" };
    const out = mergeReloaded(mine, base, { ...base, jdText: "pasted in the re-check" });
    expect(out.jdText).toBe("pasted in the re-check");
  });

  it("with no edits it is just the stored row", () => {
    const stored = { ...base, fitBreakdown: "new" };
    expect(mergeReloaded(base, base, stored)).toEqual(stored);
  });
});
