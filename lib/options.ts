// Fixed choices used by the dropdowns across the app.

export interface ModelOption {
  id: string;
  label: string;
}

// Claude models. Pick a cheap, fast one for the "fast" job and a stronger one for writing.
export const MODEL_OPTIONS: ModelOption[] = [
  { id: "claude-haiku-4-5", label: "Claude Haiku 4.5 (fastest, cheapest)" },
  { id: "claude-sonnet-5", label: "Claude Sonnet 5 (balanced, recommended for writing)" },
  { id: "claude-sonnet-4-6", label: "Claude Sonnet 4.6" },
  { id: "claude-opus-5-5", label: "Claude Opus 5.5 (most capable Opus)" },
  { id: "claude-opus-5", label: "Claude Opus 5" },
  { id: "claude-opus-4-8", label: "Claude Opus 4.8" },
  { id: "claude-fable-5-1", label: "Claude Fable 5.1 (most capable, highest cost)" },
];

export const WORK_MODES = ["Remote", "Hybrid", "On-site"] as const;
export type WorkMode = (typeof WORK_MODES)[number];

export const JOB_SOURCES = [
  "LinkedIn",
  "Indeed",
  "Jobright",
  "Handshake",
  "GitHub",
  "Company site",
  "Referral",
  "Career fair",
  "Other",
];

export const SENIORITY_OPTIONS = ["Internship", "New grad", "Entry level", "Junior", "Mid-level"];

export const VISA_STATUSES = [
  "US citizen",
  "Permanent resident (green card)",
  "F-1 student (CPT)",
  "F-1 OPT",
  "F-1 STEM OPT",
  "H-1B",
  "Other work authorization",
];

// Standard US equal-employment (EEO) answers, worded the way most application forms word them.
export const GENDER_OPTIONS = ["Male", "Female", "Non-binary", "Decline to self-identify"];
export const RACE_OPTIONS = [
  "Hispanic or Latino",
  "White",
  "Black or African American",
  "Asian",
  "American Indian or Alaska Native",
  "Native Hawaiian or Other Pacific Islander",
  "Two or more races",
  "Decline to self-identify",
];
export const VETERAN_OPTIONS = [
  "I am not a protected veteran",
  "I identify as one or more of the classifications of protected veteran",
  "I don't wish to answer",
];
export const DISABILITY_OPTIONS = [
  "Yes, I have a disability, or have had one in the past",
  "No, I do not have a disability",
  "I don't wish to answer",
];

export const DEGREE_TYPES = [
  "No degree / currently studying",
  "Associate degree",
  "Bachelor's degree",
  "Bachelor of Science (B.S.)",
  "Bachelor of Arts (B.A.)",
  "Bachelor of Engineering (B.E.)",
  "Master's degree",
  "Master of Science (M.S.)",
  "Master of Business Administration (MBA)",
  "Doctorate (Ph.D.)",
];

// Suggestions only: the major and minor fields still accept anything typed.
export const FIELD_OF_STUDY_SUGGESTIONS = [
  "Information Technology and Management",
  "Computer Science",
  "Computer Engineering",
  "Software Engineering",
  "Data Science",
  "Artificial Intelligence",
  "Machine Learning",
  "Information Systems",
  "Cybersecurity",
  "Electrical Engineering",
  "Human-Computer Interaction",
  "Design",
  "Business Administration",
  "Mathematics",
  "Statistics",
  "Economics",
];

export const START_PRESETS = ["Immediately", "Within 2 weeks", "Within 1 month", "After graduation"];

export const SALARY_SUGGESTIONS = [
  "Open / negotiable",
  "$70,000 - $90,000",
  "$90,000 - $110,000",
  "$110,000 - $130,000",
  "$130,000 - $150,000",
  "$150,000+",
];

export const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
