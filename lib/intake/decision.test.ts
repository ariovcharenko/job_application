import { describe, expect, it } from "vitest";
import { DEFAULT_PREFERENCES } from "../defaults";
import type { Criterion } from "../scoring/criteria";
import type { MustHaves } from "../types";
import {
  compareHeadlines,
  decideApply,
  filterExplanation,
  headlineFor,
  MUST_HAVE_FILTERS,
  normalizeLegacyCriteria,
  skillsMatchPercent,
  uniqueQuotes,
  verdictFor,
} from "./decision";

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
    expect(verdictFor({ canApply: true }, null)).toBe("unknown-match");
    expect(verdictFor({ canApply: false }, null)).toBe("dont-apply");
    expect(verdictFor({ canApply: true }, 50)).toBe("apply");
  });
});

describe("reasons: one plain line, the posting's quote once", () => {
  const quote = "We are unable to sponsor F-1, H-1B or OPT candidates now or in the future";
  // A made-up posting where sponsorship and OPT both cite the same sentence.
  const roboticsJob: Criterion[] = allPass.map((x) =>
    x.key === "sponsorship"
      ? { ...c("sponsorship", "fail", `Rules out sponsorship. "${quote}"`), quote }
      : x.key === "opt"
        ? { ...c("opt", "fail", `Rules out OPT or future sponsorship. "${quote}."`), quote: `${quote}.` }
        : x.key === "location"
          ? c("location", "fail", "Hybrid. San Mateo, CA isn't in your locations.")
          : x,
  );

  it("shows a shared sponsorship/OPT quote once, with a plain summary", () => {
    const d = decideApply(roboticsJob, all);
    const work = d.failed.find((f) => f.key === "workAuth")!;
    expect(work.summary).toBe("Won't sponsor visas and excludes OPT.");
    expect(work.quotes).toHaveLength(1);
    expect(work.quotes![0]).toContain("unable to sponsor");
    const loc = d.failed.find((f) => f.key === "location")!;
    expect(loc.summary).toBe("Hybrid. San Mateo, CA isn't in your locations.");
    expect(loc.quotes).toEqual([]);
  });

  it("derives the same from older saved results that only have details", () => {
    const legacy = { key: "workAuth" as const, label: "x", status: "fail" as const, details: [`Rules out sponsorship. "${quote}"`, `Rules out OPT or future sponsorship. "${quote}"`] };
    const e = filterExplanation(legacy);
    expect(e.quotes).toEqual([quote]);
    expect(e.summary).toBe("Rules out sponsorship. Rules out OPT or future sponsorship.");
  });

  it("keeps distinct quotes and collapses near-identical ones", () => {
    expect(uniqueQuotes(["No visas.", "no visas", "Must be a US citizen"])).toEqual(["No visas.", "Must be a US citizen"]);
    expect(uniqueQuotes(["Cannot sponsor", "We cannot sponsor visas"])).toEqual(["We cannot sponsor visas"]);
  });

  it("lists only the unclear checks for an unclear must-have", () => {
    const d = decideApply(withStatus("opt", "unknown"), all);
    expect(d.unclear[0].summary).toBe("opt unknown");
  });
});

describe("headlineFor", () => {
  it("shows no big percent when a must-have fails, only a muted aside", () => {
    const failing = allPass.map((x) => (x.key === "location" || x.key === "sponsorship" ? c(x.key, "fail") : x));
    const h = headlineFor(decideApply(failing, all), { percent: 100 });
    expect(h.kind).toBe("not-a-fit");
    expect(h.label).toBe("Not a fit");
    expect(h.summary).toBe("Location and Work auth rule this out.");
    expect(h.aside).toBe("Skills overlap 100%. Doesn't count while a must-have fails.");
    expect(h.pill).toBe("Not a fit");
    expect(h.strong).toBe(false);
    expect(headlineFor(decideApply(withStatus("degree", "fail"), all), { percent: null }).summary).toBe("Degree rules this out.");
  });

  it("shows the percent but not as confirmed when a must-have is unclear", () => {
    const h = headlineFor(decideApply(withStatus("sponsorship", "unknown"), all), { percent: 90 });
    expect(h).toMatchObject({ kind: "check-first", percent: 90, label: "Match", summary: "Check first: Work auth.", strong: false, pill: "90% · Check first" });
  });

  it("is purple only when everything passes and the match is good", () => {
    expect(headlineFor(decideApply(allPass, all), { percent: 80 })).toMatchObject({ kind: "match", strong: true, label: "Match", pill: "80% · Apply" });
    expect(headlineFor(decideApply(allPass, all), { percent: 20 })).toMatchObject({ kind: "weak", strong: false });
  });

  it("has no number when there's no skills match", () => {
    expect(headlineFor(decideApply(allPass, all), null)).toMatchObject({ kind: "unknown", percent: null, strong: false });
    expect(headlineFor(decideApply(allPass, all), { percent: null }).kind).toBe("unknown");
  });

  it("sorts jobs that fail a must-have last, whatever their skills overlap", () => {
    const fail = headlineFor(decideApply(withStatus("location", "fail"), all), { percent: 100 });
    const good = headlineFor(decideApply(allPass, all), { percent: 60 });
    const unclear = headlineFor(decideApply(withStatus("degree", "unknown"), all), { percent: 70 });
    const none = headlineFor(decideApply(allPass, all), null);
    expect([fail, good, none, unclear].sort(compareHeadlines).map((h) => h.kind)).toEqual(["check-first", "match", "unknown", "not-a-fit"]);
  });
});
