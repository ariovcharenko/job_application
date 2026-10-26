import { describe, expect, it } from "vitest";
import { possessive } from "./possessive";

describe("possessive", () => {
  it("adds 's to most names", () => expect(possessive("Brightloop")).toBe("Brightloop's"));
  it("adds only an apostrophe after s", () => {
    expect(possessive("Fernhill Systems")).toBe("Fernhill Systems'");
    expect(possessive("Taskwise Labs")).toBe("Taskwise Labs'");
  });
  it("leaves an empty name alone", () => expect(possessive("  ")).toBe(""));
});
