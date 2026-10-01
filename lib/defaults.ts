import type { AppSettings, Preferences, Profile } from "./types";

export const DEFAULT_SETTINGS: AppSettings = {
  id: "app",
  provider: "anthropic",
  anthropicKey: "",
  workspaceId: "",
  fastModel: "claude-haiku-4-5",
  smartModel: "claude-sonnet-5",
  jsearchApiKey: "",
};

export const DEFAULT_PROFILE: Profile = {
  id: "me",
  fullName: "",
  email: "",
  phone: "",
  location: "",
  linkedin: "",
  github: "",
  portfolio: "",
  school: "",
  degreeType: "",
  major: "",
  minor: "",
  graduation: "",
  gpa: "",
  authorizedToWorkUS: "",
  requiresSponsorship: "",
  visaStatus: "",
  gender: "",
  race: "",
  veteran: "",
  disability: "",
  salaryExpectation: "",
  earliestStart: "",
  willingToRelocate: "",
};

// Neutral on purpose: a new user picks their own level, roles and locations. Nothing here may
// describe one particular person (lib/defaults.test.ts checks).
export const DEFAULT_PREFERENCES: Preferences = {
  id: "me",
  targetRoles: [],
  keywords: [],
  seniority: [],
  experienceLevel: "",
  workModes: ["Remote", "Hybrid", "On-site"],
  locations: [],
  companyWatchlist: [],
  mustHaves: { experience: true, degree: true, location: true, workAuth: true, clearance: true },
  dealBreakers: {
    noSponsorship: true,
    citizenshipRequired: true,
    clearanceRequired: true,
    locationOutsideTargets: true,
  },
  weights: { sponsorship: 30, location: 25, match: 25, other: 10, freshness: 10 },
  applyThreshold: 75,
};
