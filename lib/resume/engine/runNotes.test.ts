import { describe, expect, it } from "vitest";
import { addedSkillMessage, isSlow, polishFailed, updateDoneMessage } from "./runNotes";

describe("runNotes", () => {
  it("flags a slow run after 60 seconds", () => {
    expect(isSlow(59)).toBe(false);
    expect(isSlow(60)).toBe(true);
  });
  it("polishFailed: only when the polish call ran and did not apply, and she didn't skip it", () => {
    expect(polishFailed({ calls: 1, notes: [] }, false)).toBe(false);
    expect(polishFailed({ calls: 2, notes: ["Polished automatically: fixed 1 writing issue in one extra pass."] }, false)).toBe(false);
    expect(polishFailed({ calls: 2, notes: [] }, false)).toBe(true);
    expect(polishFailed({ calls: 2, notes: [] }, true)).toBe(false);
  });
  it("counts yellow spots", () => {
    expect(updateDoneMessage(0)).toMatch(/Nothing/);
    expect(updateDoneMessage(1)).toBe("Update finished. 1 spot is marked in yellow.");
    expect(updateDoneMessage(5)).toBe("Update finished. 5 spots are marked in yellow.");
  });
  it("confirms a skill add", () => expect(addedSkillMessage("Docker")).toBe("Added Docker to your Skills line."));
});
