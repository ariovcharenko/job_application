import { describe, expect, it } from "vitest";
import { DEFAULT_PREFERENCES, DEFAULT_PROFILE } from "./defaults";

// A stranger opening the app must get neutral defaults: nothing that describes one person.

describe("defaults", () => {
  it("start with no roles, level, locations or watchlist, every work style and every must-have on", () => {
    expect(DEFAULT_PREFERENCES).toMatchObject({
      targetRoles: [],
      keywords: [],
      seniority: [],
      experienceLevel: "",
      locations: [],
      workModes: ["Remote", "Hybrid", "On-site"],
      companyWatchlist: [],
      mustHaves: { experience: true, degree: true, location: true, workAuth: true, clearance: true },
    });
    expect(DEFAULT_PREFERENCES).not.toHaveProperty("regions");
  });

  it("leave every Profile field blank", () => {
    for (const [key, value] of Object.entries(DEFAULT_PROFILE)) if (key !== "id") expect(value, key).toBe("");
  });

  it("mention no particular place, visa or company", () => {
    const text = JSON.stringify({ DEFAULT_PREFERENCES, DEFAULT_PROFILE });
    for (const word of ["Orange County", "Los Angeles", "OPT", "F-1", "Amazon", "Google", "Alex"]) expect(text).not.toContain(word);
  });
});
