import type { Application } from "../types";

export function blankApplication(now: number = Date.now()): Application {
  return {
    company: "",
    stage: "Saved",
    role: "",
    url: "",
    location: "",
    workMode: "Unknown",
    appliedDate: "",
    respondDate: "",
    referral: "",
    tailoredUrl: "",
    contactName: "",
    contactLinkedin: "",
    roleType: "Other",
    salary: "",
    source: "",
    visa: "unknown",
    followUpDate: "",
    notes: "",
    jdText: "",
    createdAt: now,
    updatedAt: now,
  };
}
