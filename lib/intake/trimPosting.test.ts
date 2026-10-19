import { describe, expect, it } from "vitest";
import { CHECK_MAX_CHARS, trimPostingForCheck } from "./trimPosting";

// A fictional posting with a lot of boilerplate around a few sentences that must survive.
const MUST_KNOW = [
  "We are unable to sponsor work visas now or in the future.",
  "Candidates on OPT or CPT are not eligible.",
  "This role requires U.S. citizenship and an active security clearance.",
  "The role is hybrid, three days a week in our Austin office.",
  "Minimum 2 years of professional experience with TypeScript.",
  "Bachelor's degree in Computer Science or equivalent practical experience.",
];

const FLUFF = "We love our people and our mission to make plants happier, together, every single day of the week. ";
const bigBenefits = Array.from({ length: 30 }, (_, i) => `Perk ${i}: free lunch, gym stipend, pet insurance, 401k match, and a wellness budget for everyone.`);

function posting(extra: string[] = [], inBoring = false): string {
  return [
    "Software Engineer, Platform",
    "Leafwise Inc. - Austin, TX - Posted 2 days ago",
    "",
    "About Leafwise",
    FLUFF.repeat(12),
    inBoring ? MUST_KNOW[0] : "",
    "",
    "What you'll do",
    "Build and run the services that power our plant-care app.",
    "Own reliability for the platform and on-call rotation.",
    "",
    "Qualifications",
    ...MUST_KNOW.slice(1, 3),
    MUST_KNOW[5],
    "",
    "Benefits",
    ...bigBenefits,
    inBoring ? MUST_KNOW[3] : "",
    "",
    "Equal Opportunity Employer",
    "Leafwise is an equal opportunity employer and does not discriminate on the basis of race. " + (inBoring ? MUST_KNOW[4] : ""),
    "Privacy policy. Terms of use. All rights reserved. Download our app on the App Store and Google Play.",
    ...extra,
  ].join("\n");
}

describe("trimPostingForCheck", () => {
  it("returns a short posting untouched", () => {
    const t = "Engineer\nBuild things.\nNo sponsorship.";
    expect(trimPostingForCheck(t)).toBe(t);
  });

  it("drops boilerplate and keeps the posting well under the cap", () => {
    const raw = posting();
    const out = trimPostingForCheck(raw);
    expect(out.length).toBeLessThan(raw.length * 0.6);
    expect(out.length).toBeLessThanOrEqual(CHECK_MAX_CHARS);
    expect(out).not.toContain("pet insurance");
    expect(out).not.toContain("App Store");
    expect(out).toContain("Build and run the services");
    expect(out).toContain("Software Engineer, Platform");
  });

  it("keeps every must-know sentence, even when it sits inside benefits, about-us or EEO text", () => {
    const raw = posting([], true);
    const out = trimPostingForCheck(raw);
    for (const s of MUST_KNOW) expect(out, s).toContain(s);
  });

  it("keeps must-know sentences from a long posting after the opening", () => {
    const filler = Array.from({ length: 200 }, (_, i) => `Our team enjoys board games number ${i} and shared snacks.`).join("\n");
    const raw = ["Backend Engineer", "Some Co - Remote (US)", filler, "Benefits", filler, ...MUST_KNOW].join("\n");
    const out = trimPostingForCheck(raw);
    expect(out.length).toBeLessThanOrEqual(CHECK_MAX_CHARS);
    for (const s of MUST_KNOW) expect(out, s).toContain(s);
  });

  it("does not treat 'About the role' as marketing", () => {
    const raw = ["Designer", "Studio - NYC", FLUFF.repeat(30), "About the role", "You will design onboarding flows in Figma for new users.", "About Studio", FLUFF.repeat(20), "Benefits", bigBenefits.join("\n")].join("\n");
    const out = trimPostingForCheck(raw);
    expect(out).toContain("onboarding flows in Figma");
  });

  it("falls back to the (capped) original when trimming leaves too little", () => {
    const raw = ["Role", ...Array.from({ length: 150 }, () => "Equal opportunity employer. Download our app. Cookies policy.")].join("\n");
    expect(trimPostingForCheck(raw).length).toBeGreaterThan(600);
  });

  it("respects a custom cap", () => {
    const raw = posting();
    expect(trimPostingForCheck(raw, 1500).length).toBeLessThanOrEqual(1500);
  });
});
