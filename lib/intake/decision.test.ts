import { describe, expect, it } from "vitest";
import { DEFAULT_PREFERENCES } from "../defaults";
import type { Criterion } from "../scoring/criteria";
import type { MustHaves } from "../types";
import { decideApply, MUST_HAVE_FILTERS, normalizeLegacyCriteria, skillsMatchPercent, verdictFor } from "./decision";

const c = (key: Criterion["key"], status: Criterion["status"], detail = `${key} ${status}`): Criterion => ({ key, label: key, status, detail });

const allPass: Criterion[] = [
  c("sponsorship", "pass"),
  c("opt", "pass"),
  c("citizenship", "pass"),
  c("clearance", "pass"),
  c("location", "pass"),
  c("experience", "pass"),
  c("degree", "pass"),
  c("skills", "pass"),
];
const withStatus = (key: Criterion["key"], status: Criterion["status"]) => allPass.map((x) => (x.key === key ? c(key, status) : x));
const all = DEFAULT_PREFERENCES.mustHaves;

describe("decideApply", () => {
  it("says apply when every must-have passes", () => {
    const d = decideApply(allPass, all);
    expect(d.canApply).toBe(true);
    expect(d.failed).toEqual([]);
    expect(d.filters).toHaveLength(5);
  });

  it("says don't apply and names the failed must-have", () => {
    const d = decideApply(withStatus("degree", "fail"), all);
    expect(d.canApply).toBe(false);
    expect(d.failed.map((f) => f.key)).toEqual(["degree"]);
    expect(d.failed[0].details).toEqual(["degree fail"]);
  });

  it("counts sponsorship, OPT and citizenship as the work-authorization filter, and clearance on its own", () => {
    expect(decideApply(withStatus("citizenship", "fail"), all).failed.map((f) => f.key)).toEqual(["workAuth"]);
    expect(decideApply(withStatus("sponsorship", "fail"), all).failed.map((f) => f.key)).toEqual(["workAuth"]);
    expect(decideApply(withStatus("opt", "fail"), all).failed.map((f) => f.key)).toEqual(["workAuth"]);
    expect(decideApply(withStatus("clearance", "fail"), all).failed.map((f) => f.key)).toEqual(["clearance"]);
  });

  it("passes the work-authorization filter when its rows were omitted (no sponsorship needed)", () => {
    const d = decideApply(allPass.filter((x) => x.key !== "sponsorship" && x.key !== "opt"), all);
    expect(d.filters.find((f) => f.key === "workAuth")?.status).toBe("pass");
  });

  it("maps an old combined citizenship/clearance failure to the clearance filter", () => {
    const old = [c("citizenship", "fail", "Requires a security clearance.")];
    expect(normalizeLegacyCriteria(old)[0].key).toBe("clearance");
    expect(decideApply(old, all).failed.map((f) => f.key)).toEqual(["clearance"]);
    expect(decideApply([c("citizenship", "fail", "Requires US citizenship.")], all).failed.map((f) => f.key)).toEqual(["workAuth"]);
  });

  it("uses the labels and pills from the spec", () => {
    expect(MUST_HAVE_FILTERS.map((f) => f.label)).toEqual([
      "Matches my experience level",
      "My degree meets the requirement",
      "In my locations, with a work style I accept",
      "Works with my work authorization",
      "No security clearance required",
    ]);
    expect(MUST_HAVE_FILTERS.map((f) => f.short)).toEqual(["Level", "Degree", "Location", "Work auth", "Clearance"]);
  });

  it("treats a posting that doesn't say as unclear, not as a pass or a fail", () => {
    const d = decideApply(withStatus("sponsorship", "unknown"), all);
    expect(d.canApply).toBe(true);
    expect(d.unclear.map((f) => f.key)).toEqual(["workAuth"]);
  });

  it("ignores a failed check when she has turned that filter off", () => {
    const off: MustHaves = { ...all, degree: false };
    const d = decideApply(withStatus("degree", "fail"), off);
    expect(d.canApply).toBe(true);
    expect(d.filters.map((f) => f.key)).not.toContain("degree");
  });

  it("never lets the skills check block applying (skills are the percentage, not a filter)", () => {
    expect(decideApply(withStatus("skills", "fail"), all).canApply).toBe(true);
  });
});

describe("skillsMatchPercent", () => {
  const m = (have: number, gap: number) => ({ have: Array(have).fill("x"), gap: Array(gap).fill("y") });

  it("weights required skills 3:1 over preferred", () => {
    expect(skillsMatchPercent(m(4, 0), m(0, 4)).percent).toBe(75);
    expect(skillsMatchPercent(m(3, 1), m(2, 2)).percent).toBe(69);
  });

  it("uses whichever list exists when the job gives only one", () => {
    expect(skillsMatchPercent(m(1, 1), m(0, 0)).percent).toBe(50);
    expect(skillsMatchPercent(m(0, 0), m(3, 1)).percent).toBe(75);
  });

  it("is null when the posting lists no skills", () => {
    expect(skillsMatchPercent(m(0, 0), m(0, 0)).percent).toBeNull();
  });
});

describe("verdictFor", () => {
  it("puts must-haves first, then the match percentage", () => {
    expect(verdictFor({ canApply: false }, 95)).toBe("dont-apply");
    expect(verdictFor({ canApply: true }, 80)).toBe("apply");
    expect(verdictFor({ canApply: true }, 30)).toBe("low-match");
    expect(verdictFor({ canApply: true }, null)).toBe("apply");
  });
});
