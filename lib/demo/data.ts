import { DEFAULT_PREFERENCES, DEFAULT_PROFILE } from "../defaults";
import type { JobSignals } from "../scoring/signals";
import type { AnswerBankEntry, Contact, Preferences, Profile, Stage } from "../types";

// A made-up candidate and made-up jobs for showing the app off on a local copy (app/demo). Every
// person, company and link here is fictional; links use example.com. Nothing here describes a
// real user.

export const DEMO_PROFILE: Profile = {
  ...DEFAULT_PROFILE,
  fullName: "Riley Park",
  email: "riley.park@example.com",
  phone: "(555) 010-4477",
  location: "Seattle, WA",
  linkedin: "https://www.linkedin.com/in/example-riley-park/",
  github: "https://github.com/example-riley",
  portfolio: "https://riley.example.com/",
  school: "University of Washington",
  degreeType: "Bachelor's degree",
  major: "Computer Science",
  graduation: "2026-06",
  gpa: "3.8",
  authorizedToWorkUS: "yes",
  requiresSponsorship: "no",
  visaStatus: "US citizen",
  willingToRelocate: "yes",
  earliestStart: "2026-07-06",
};

export const DEMO_PREFERENCES: Preferences = {
  ...DEFAULT_PREFERENCES,
  experienceLevel: "new-grad",
  locations: ["metro:seattle", "metro:sf-bay-area", "remote-us"],
  workModes: ["Remote", "Hybrid", "On-site"],
};

/** Riley's "Your experience": more than fits on a page, so tailoring has real choices to make. */
export const DEMO_EXPERIENCE = `### Education
**University of Washington | Seattle, WA | B.S. Computer Science | Jun 2026**
- GPA: 3.8/4.0
- Relevant coursework: Distributed Systems, Databases, Machine Learning, Operating Systems, Computer Networks

### Experience
**Software Engineer Intern | Cobalt Payments | Seattle, WA | Jun 2025 - Sep 2025**
- Developed a refund status service in Go and PostgreSQL that handled 40,000 requests a day with p99 latency under 120 ms
- Added idempotency keys to the payouts API, removing 100% of duplicate payouts seen during retries
- Automated integration tests with Docker Compose that ran in GitHub Actions on every pull request, cutting flaky builds by 60%
- Instrumented the service with OpenTelemetry traces and Grafana dashboards used by the on-call rotation
- Migrated two cron jobs to AWS Lambda and SQS, lowering monthly compute cost by 35%
- Authored the design doc for webhook retries, reviewed by 6 senior engineers before rollout

**Frontend Engineer Intern | Lumen Health | Remote | Jun 2024 - Sep 2024**
- Shipped a React and TypeScript scheduling page for patients, used by 3,000 people in its first month
- Designed an accessible date picker with full keyboard support, passing an external WCAG 2.1 AA audit
- Cut the dashboard bundle size by 45% by code-splitting routes and lazy-loading charts
- Tested every component with Jest and React Testing Library, raising coverage from 52% to 88%
- Partnered with 2 designers in Figma to turn usability feedback into 14 shipped UI fixes

**Undergraduate Research Assistant | UW Systems Lab | Seattle, WA | Jan 2025 - Jun 2026**
- Engineered a Python benchmarking harness for a distributed key-value store, running 200+ experiments on 16 nodes
- Profiled tail latency with eBPF and found a lock contention bug that cut p99 reads by 30%
- Co-authored a workshop paper on adaptive replication, presenting results to 50 attendees

**Teaching Assistant, Data Structures | University of Washington | Seattle, WA | Sep 2024 - Jun 2026**
- Led weekly sections for 30 students and held office hours for a 400-student course
- Created 12 autograded Java assignments with JUnit test suites

### Projects
**Personal project | Trailhead | Seattle, WA | Jan 2025 - Apr 2025**
- Built a full-stack hiking trip planner with Next.js, Node.js and PostgreSQL, used by 500 monthly users
- Deployed on AWS with Docker and Terraform, with CI/CD in GitHub Actions

**Hackathon project | ShelfLife | Seattle, WA | Oct 2024**
- Built an Android app in Kotlin that scans receipts with an OCR API to track food expiry dates, winning 2nd place of 60 teams

### Leadership & Involvement
- ACM Student Chapter, Vice President | Sep 2024 - Present
- Women in Computing, Mentor | Jan 2025 - Present

### Skills inventory
- **Languages:** Go, TypeScript, JavaScript, Python, Java, Kotlin, SQL
- **Frontend:** React, Next.js, HTML/CSS, Tailwind CSS
- **Backend & Data:** Node.js, PostgreSQL, REST APIs, gRPC, Redis
- **Cloud & DevOps:** AWS (Lambda, SQS, S3), Docker, Terraform, GitHub Actions (CI/CD)
- **Testing & Observability:** Jest, React Testing Library, JUnit, OpenTelemetry, Grafana
- **Tools:** Git, Figma, Linux, eBPF
`;

export interface DemoJob {
  signals: JobSignals;
  url: string;
  jd: string;
  stage: Stage;
  /** Days ago she applied (stage past Saved). */
  appliedDaysAgo?: number;
  respondedDaysAgo?: number;
  triage?: "checked" | "skipped";
  /** Tailor a resume for it. */
  resume: boolean;
  notes?: string;
  referral?: string;
}

const signals = (s: Partial<JobSignals> & Pick<JobSignals, "company" | "role" | "location" | "mustHaveSkills">): JobSignals => ({
  workMode: "Hybrid",
  salary: "",
  seniority: "New grad",
  niceToHaveSkills: [],
  visaSignal: "unknown",
  visaEvidence: "",
  citizenshipRequired: false,
  clearanceRequired: false,
  freshness: "within_week",
  freshnessEvidence: "",
  optSignal: "unknown",
  optEvidence: "",
  minYearsExperience: 0,
  degreeRequired: "bachelors",
  ...s,
});

/** A full-length posting: the job-specific part plus the sections every real posting has. */
const jd = (company: string, role: string, place: string, body: string) => `${company} · ${role}
${place}

About the role
${body.trim()}

Responsibilities
- Design, build, test and ship features with a small team, from the first design doc to production
- Review code, write clear documentation, and keep the systems you own reliable and observable
- Work closely with product managers and designers to understand users and measure what you ship
- Take part in an on-call rotation with support from senior engineers once you are ramped up

Qualifications
- Bachelor's degree in Computer Science, a related field, or equivalent practical experience
- Strong fundamentals in data structures, algorithms and software design
- Clear written and spoken communication, and curiosity about how things work

Benefits
Competitive salary and equity, medical, dental and vision insurance, a 401(k) match, a learning
budget and flexible time off. ${company} is an equal opportunity employer and considers all
qualified applicants without regard to race, color, religion, sex, sexual orientation, gender
identity, national origin, disability or veteran status.`;

export const DEMO_JOBS: DemoJob[] = [
  {
    signals: signals({
      company: "Northwind Labs",
      role: "Software Engineer, Early Career",
      location: "Seattle, WA",
      salary: "$135,000 - $160,000",
      mustHaveSkills: ["TypeScript", "React", "PostgreSQL", "REST APIs"],
      niceToHaveSkills: ["AWS", "Docker"],
      visaSignal: "sponsors",
    }),
    url: "https://jobs.example.com/northwind-labs/software-engineer-early-career",
    jd: jd("Northwind Labs", "Software Engineer, Early Career", "Seattle, WA (Hybrid) · $135,000 - $160,000", `
Northwind Labs builds scheduling software for community clinics. Join our Patient Experience team.
What you'll do: build features across our React and TypeScript front end and Node.js services, design PostgreSQL schemas, write tests.
Requirements: 0 to 2 years of experience, a bachelor's in CS or similar, TypeScript, React, PostgreSQL, REST APIs.
Nice to have: AWS, Docker. We sponsor visas.`),
    stage: "Offer",
    appliedDaysAgo: 34,
    respondedDaysAgo: 3,
    resume: true,
    notes: "Offer call went well. Decision due Friday.",
  },
  {
    signals: signals({
      company: "Cobalt Payments",
      role: "Software Engineer, New Grad (Payments Platform)",
      location: "Seattle, WA",
      salary: "$145,000 - $170,000",
      mustHaveSkills: ["Go", "PostgreSQL", "AWS", "Distributed systems"],
      niceToHaveSkills: ["gRPC", "Terraform"],
    }),
    url: "https://careers.example.com/cobalt/new-grad-payments",
    jd: jd("Cobalt Payments", "Software Engineer, New Grad (Payments Platform)", "Seattle, WA (Hybrid)", `
Build reliable payment services in Go on AWS. You'll own APIs end to end, from design doc to on-call.
Requirements: Go, PostgreSQL, AWS, interest in distributed systems. Nice to have: gRPC, Terraform.`),
    stage: "Waiting for interview",
    appliedDaysAgo: 12,
    respondedDaysAgo: 4,
    referral: "Former intern manager",
    resume: true,
  },
  {
    signals: signals({
      company: "Lumen Health",
      role: "Frontend Engineer I",
      location: "Remote (US)",
      workMode: "Remote",
      mustHaveSkills: ["React", "TypeScript", "Accessibility", "Jest"],
      niceToHaveSkills: ["Next.js", "Figma"],
    }),
    url: "https://jobs.example.com/lumen-health/frontend-engineer-i",
    jd: jd("Lumen Health", "Frontend Engineer I", "Remote (US)", `
Build accessible patient-facing web apps in React and TypeScript. Partner with design in Figma.
Requirements: React, TypeScript, accessibility (WCAG), Jest. Nice to have: Next.js.`),
    stage: "Applied",
    appliedDaysAgo: 9,
    resume: true,
  },
  {
    signals: signals({
      company: "Atlas Cloud",
      role: "Backend Engineer I",
      location: "San Francisco, CA",
      salary: "$150,000 - $175,000",
      mustHaveSkills: ["Python", "Distributed systems", "Linux", "Docker"],
      niceToHaveSkills: ["Kubernetes", "Go"],
      visaSignal: "sponsors",
    }),
    url: "https://jobs.example.com/atlas-cloud/backend-engineer-i",
    jd: jd("Atlas Cloud", "Backend Engineer I", "San Francisco, CA (On-site)", `
Work on our storage control plane: Python and Go services on Linux, deployed with Docker and Kubernetes.
Requirements: Python, distributed systems fundamentals, Linux, Docker. Nice to have: Kubernetes, Go.`),
    stage: "Applied",
    appliedDaysAgo: 5,
    resume: true,
  },
  {
    signals: signals({
      company: "Harbor Analytics",
      role: "Software Engineer, Data Platform",
      location: "Remote (US)",
      workMode: "Remote",
      mustHaveSkills: ["Python", "SQL", "AWS", "Redis"],
      niceToHaveSkills: ["Terraform"],
      freshness: "within_24h",
    }),
    url: "https://jobs.example.com/harbor-analytics/software-engineer-data-platform",
    jd: jd("Harbor Analytics", "Software Engineer, Data Platform", "Remote (US)", `
Build the pipelines and APIs behind our analytics product. Python, SQL and AWS every day.
Requirements: Python, SQL, AWS, Redis. Nice to have: Terraform. Posted today.`),
    stage: "Saved",
    resume: true,
  },
  {
    signals: signals({
      company: "Pinecrest Robotics",
      role: "Software Engineer, Embedded Rust",
      location: "Seattle, WA",
      workMode: "On-site",
      mustHaveSkills: ["Rust", "C++", "Embedded Linux"],
    }),
    url: "https://jobs.example.com/pinecrest/software-engineer-embedded-rust",
    jd: jd("Pinecrest Robotics", "Software Engineer, Embedded Rust", "Seattle, WA (On-site)", `
Write firmware and tooling for warehouse robots. Requirements: Rust, C++, embedded Linux.`),
    stage: "Rejected",
    appliedDaysAgo: 28,
    respondedDaysAgo: 10,
    resume: true,
  },
  {
    signals: signals({
      company: "Summit AI",
      role: "Machine Learning Engineer, New Grad",
      location: "San Francisco, CA",
      mustHaveSkills: ["Python", "Machine learning", "PyTorch", "AWS"],
      niceToHaveSkills: ["Kubernetes"],
    }),
    url: "https://jobs.example.com/summit-ai/ml-engineer-new-grad",
    jd: jd("Summit AI", "Machine Learning Engineer, New Grad", "San Francisco, CA (Hybrid)", `
Train and ship ranking models. Requirements: Python, machine learning, PyTorch, AWS.`),
    stage: "Saved",
    triage: "checked",
    resume: false,
  },
  {
    signals: signals({
      company: "Vertex Games",
      role: "Senior Software Engineer",
      location: "Austin, TX",
      workMode: "On-site",
      seniority: "Senior",
      mustHaveSkills: ["C++", "Unreal Engine"],
      minYearsExperience: 5,
    }),
    url: "https://jobs.example.com/vertex-games/senior-software-engineer",
    jd: jd("Vertex Games", "Senior Software Engineer", "Austin, TX (On-site)", `
5+ years building game engines in C++ and Unreal Engine. On-site in Austin.`),
    stage: "Saved",
    triage: "skipped",
    resume: false,
  },
];

export const DEMO_CONTACTS: (Omit<Contact, "applicationId" | "id"> & { company: string })[] = [
  { company: "Cobalt Payments", name: "Jamie Rivera", role: "University Recruiter", linkedinUrl: "https://www.linkedin.com/in/example-jamie/", type: "recruiter", status: "replied", draft: "" },
  { company: "Cobalt Payments", name: "Morgan Ellis", role: "Engineering Manager, Payouts", linkedinUrl: "https://www.linkedin.com/in/example-morgan/", type: "hiring-manager", status: "sent", draft: "" },
  { company: "Lumen Health", name: "Avery Kim", role: "Frontend Engineer (UW alum)", linkedinUrl: "https://www.linkedin.com/in/example-avery/", type: "alumni", status: "to-contact", draft: "" },
];

export const DEMO_ANSWERS: Omit<AnswerBankEntry, "id">[] = [
  {
    question: "Why do you want to work here?",
    answer: "I like building products people rely on every day, and your team's focus on reliability matches the work I enjoyed most at my internships.",
    tags: ["motivation"],
  },
  {
    question: "Tell us about a technical challenge you solved.",
    answer: "At Cobalt Payments, retries were creating duplicate payouts. I added idempotency keys to the payouts API, which removed every duplicate we had seen.",
    tags: ["behavioral", "backend"],
  },
  { question: "What is your expected salary?", answer: "Open, based on the full package; my research puts this role around $140,000 to $160,000.", tags: ["salary"] },
  { question: "When can you start?", answer: "July 6, 2026, after I graduate in June.", tags: ["logistics"] },
];
