import { describe, expect, it } from "vitest";
import { DEFAULT_PREFERENCES, DEFAULT_PROFILE, DEFAULT_SETTINGS } from "./defaults";
import { READINESS_LINKS, readiness, type ReadinessInput } from "./readiness";

const MASTER = `### Experience
**Software Engineer | Acme | Austin, TX | Jun 2024 - Present**
- Built things with **React** and TypeScript

### Skills inventory
- **Languages:** TypeScript, Python
`;

const fresh: ReadinessInput = {
  settings: DEFAULT_SETTINGS,
  profile: DEFAULT_PROFILE,
  masterProfile: "",
  preferences: DEFAULT_PREFERENCES,
};

const full: ReadinessInput = {
  settings: { anthropicKey: "sk-ant-x" },
  profile: { fullName: "Sam Rivera", email: "sam@example.com", requiresSponsorship: "no" },
  masterProfile: MASTER,
  preferences: { experienceLevel: "early", locations: ["state:TX"] },
};

describe("readiness", () => {
  it("is 0 of 6 in a fresh browser", () => {
    const r = readiness(fresh);
    expect(r.total).toBe(6);
    expect(r.done).toBe(0);
    expect(r.complete).toBe(false);
    expect(r.next?.key).toBe("key");
  });

  it("is complete when all six are set", () => {
    const r = readiness(full);
    expect(r.done).toBe(6);
    expect(r.complete).toBe(true);
    expect(r.next).toBeNull();
  });

  it("needs both name and email", () => {
    const r = readiness({ ...full, profile: { ...full.profile, email: "  " } });
    expect(r.items.find((i) => i.key === "contact")?.done).toBe(false);
    expect(r.done).toBe(5);
  });

  it("treats an unanswered sponsorship question as not done, and either answer as done", () => {
    const item = (v: "" | "yes" | "no") => readiness({ ...full, profile: { ...full.profile, requiresSponsorship: v } }).items.find((i) => i.key === "sponsorship")?.done;
    expect(item("")).toBe(false);
    expect(item("yes")).toBe(true);
    expect(item("no")).toBe(true);
  });

  it("needs a role AND a skills list in the experience", () => {
    const exp = (m: string) => readiness({ ...full, masterProfile: m }).items.find((i) => i.key === "experience")?.done;
    expect(exp(MASTER)).toBe(true);
    expect(exp("### Skills inventory\n- **Languages:** Go\n")).toBe(false);
    expect(exp("### Experience\n**Engineer | Acme | Austin, TX | 2024 - 2025**\n- Did work\n")).toBe(false);
    expect(exp("Just some pasted text")).toBe(false);
  });

  it("needs a level and at least one location", () => {
    expect(readiness({ ...full, preferences: { experienceLevel: "", locations: ["us"] } }).items.find((i) => i.key === "level")?.done).toBe(false);
    expect(readiness({ ...full, preferences: { experienceLevel: "mid", locations: [] } }).items.find((i) => i.key === "locations")?.done).toBe(false);
  });

  it("links every item to a real card anchor", () => {
    expect(READINESS_LINKS.key).toBe("/settings#anthropic-api-key");
    expect(READINESS_LINKS.profile).toBe("/settings#profile");
    expect(READINESS_LINKS.experience).toBe("/resumes#your-experience");
    expect(READINESS_LINKS.preferences).toBe("/settings#job-preferences");
    for (const i of readiness(fresh).items) expect(i.href).toMatch(/^\/(settings|resumes)#[a-z-]+$/);
  });
});
