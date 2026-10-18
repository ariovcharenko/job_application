import { getAnswerBank, getMasterProfile, getProfile, db } from "../db";
import { parseMasterExperiences } from "../resume/master/experiences";
import type { Application, Profile } from "../types";
import type { SyncedData, SyncedExperience, SyncedJob, SyncedProfile } from "./protocol";

/** The Profile fields the extension may see. Picked one by one so a new Profile field (or a key
 * added to it someday) is never sent by accident. */
export function syncedProfile(p: Profile): SyncedProfile {
  return {
    fullName: p.fullName,
    email: p.email,
    phone: p.phone,
    location: p.location,
    linkedin: p.linkedin,
    github: p.github,
    portfolio: p.portfolio,
    school: p.school,
    degreeType: p.degreeType,
    major: p.major,
    minor: p.minor,
    graduation: p.graduation,
    gpa: p.gpa,
    authorizedToWorkUS: p.authorizedToWorkUS,
    requiresSponsorship: p.requiresSponsorship,
    visaStatus: p.visaStatus,
    gender: p.gender,
    race: p.race,
    veteran: p.veteran,
    disability: p.disability,
    salaryExpectation: p.salaryExpectation,
    earliestStart: p.earliestStart,
    willingToRelocate: p.willingToRelocate,
  };
}

/** Jobs she may apply to (not skipped), as a small index: id, company, role, link, stage. */
export function jobsIndex(apps: Application[]): SyncedJob[] {
  return apps
    .filter((a) => a.id !== undefined && a.triage !== "skipped")
    .map((a) => ({ id: a.id!, company: a.company, role: a.role, url: a.url, stage: a.stage }));
}

export function experiencesOf(master: string): SyncedExperience[] {
  return parseMasterExperiences(master).map((e) => ({
    title: e.title,
    company: e.company,
    location: e.location,
    dates: e.dates,
    section: e.section,
    bullets: e.block
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => /^[-*•]\s+/.test(l))
      .map((l) => l.replace(/^[-*•]\s+/, "")),
  }));
}

/** Everything the extension gets: Profile, answer bank, "Your experience", the jobs index. No keys. */
export async function buildSyncedData(now: number = Date.now()): Promise<SyncedData> {
  const [profile, answers, master, apps] = await Promise.all([getProfile(), getAnswerBank(), getMasterProfile(), db.applications.toArray()]);
  return {
    profile: syncedProfile(profile),
    answerBank: answers.map((a) => ({ question: a.question, answer: a.answer, tags: a.tags })),
    masterProfile: master,
    experiences: experiencesOf(master),
    jobs: jobsIndex(apps),
    updatedAt: now,
  };
}
