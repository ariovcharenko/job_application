import type { JobSignals } from "../../scoring/signals";

// Representative postings for the golden test (lib/eligibility/golden.test.ts): the verdicts an
// F-1 OPT new grad got before must-haves were driven by the candidate's Profile.

const base: JobSignals = {
  company: "Acme",
  role: "Software Engineer",
  location: "Irvine, CA",
  workMode: "Hybrid",
  salary: "",
  seniority: "",
  mustHaveSkills: [],
  niceToHaveSkills: [],
  visaSignal: "unknown",
  visaEvidence: "",
  citizenshipRequired: false,
  clearanceRequired: false,
  freshness: "unknown",
  freshnessEvidence: "",
  optSignal: "unknown",
  optEvidence: "",
  minYearsExperience: -1,
  degreeRequired: "none",
};
const j = (o: Partial<JobSignals>): JobSignals => ({ ...base, ...o });

export const GOLDEN_POSTINGS: Record<string, JobSignals> = {
  remoteNewGrad: j({ location: "Remote (US)", workMode: "Remote", seniority: "New grad", minYearsExperience: 0, visaSignal: "sponsors", freshness: "within_24h", salary: "$120k" }),
  hybridIrvine: j({ location: "Irvine, CA", workMode: "Hybrid", minYearsExperience: 1, degreeRequired: "bachelors" }),
  onsiteIrvine: j({ location: "Irvine, CA", workMode: "On-site" }),
  unknownModeIrvine: j({ location: "Irvine, CA", workMode: "Unknown" }),
  hybridAustin: j({ location: "Austin, TX", workMode: "Hybrid" }),
  unknownModeAustin: j({ location: "Austin, TX", workMode: "Unknown" }),
  onsiteAustin: j({ location: "Austin, TX", workMode: "On-site" }),
  hybridNoLocation: j({ location: "", workMode: "Hybrid" }),
  onsiteNoLocation: j({ location: "", workMode: "On-site" }),
  hybridSantaMonica: j({ location: "Santa Monica, CA (Hybrid)", workMode: "Hybrid", optSignal: "welcomes-opt", visaSignal: "opt-friendly" }),
  hybridSanDiego: j({ location: "San Diego, CA", workMode: "Hybrid" }),
  hybridGlendaleAZ: j({ location: "Glendale, AZ", workMode: "Hybrid" }),
  hybridNYC: j({ location: "New York, NY", workMode: "Hybrid" }),
  hybridLAorRemote: j({ location: "Los Angeles, CA or Remote", workMode: "Hybrid" }),
  noSponsorship: j({ visaSignal: "no-sponsorship", visaEvidence: "We do not sponsor" }),
  excludesOpt: j({ optSignal: "excludes-opt" }),
  citizenship: j({ citizenshipRequired: true, visaSignal: "no-sponsorship" }),
  clearance: j({ clearanceRequired: true }),
  threeYears: j({ minYearsExperience: 3 }),
  twoYears: j({ minYearsExperience: 2 }),
  senior: j({ role: "Senior Software Engineer", seniority: "Senior" }),
  entryUnstated: j({ seniority: "Entry level" }),
  masters: j({ degreeRequired: "masters" }),
  phd: j({ degreeRequired: "phd", minYearsExperience: 0 }),
  remoteSponsorsOpt: j({ location: "Remote", workMode: "Remote", visaSignal: "sponsors", optSignal: "welcomes-opt", minYearsExperience: 0, degreeRequired: "bachelors" }),
  hybridCostaMesa: j({ location: "Costa Mesa, California", workMode: "Hybrid", minYearsExperience: 0, visaSignal: "sponsors" }),
};
