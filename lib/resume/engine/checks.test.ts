import { describe, expect, it } from "vitest";
import { withOpenFlags } from "./checks";

const checks = [
  { id: "skills", ok: true, label: "Every skill is in your experience." },
  { id: "numbers", ok: true, label: "Every number comes from your experience." },
  { id: "links", ok: true, label: "links" },
];

describe("withOpenFlags", () => {
  it("leaves green lines alone when nothing is open", () => {
    expect(withOpenFlags(checks, [])).toEqual(checks);
    expect(withOpenFlags(checks, [{ kind: "wording" }])).toEqual(checks);
  });
  it("opens the skills line while a skill waits for her OK", () => {
    const out = withOpenFlags(checks, [{ kind: "skill" }, { kind: "skill" }]);
    expect(out[0].ok).toBe(false);
    expect(out[0].label).toBe("2 skills are waiting for your OK, marked on the page.");
    expect(out[1].ok).toBe(true);
  });
  it("uses singular for one", () => {
    expect(withOpenFlags(checks, [{ kind: "number" }])[1].label).toBe("1 number is waiting for your OK, marked on the page.");
  });
});
