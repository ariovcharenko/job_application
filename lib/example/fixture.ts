import { DEFAULT_PREFERENCES, DEFAULT_PROFILE } from "../defaults";
import type { ResumeDoc, ResumeHeader } from "../resume/engine/schema";
import type { JobSignals } from "../scoring/signals";
import type { Preferences, Profile } from "../types";

// The /example page's bundled sample: a made-up candidate and a made-up posting. The page runs
// the real assessJob over these (plain code, no AI call) and shows a pre-written tailored resume,
// so a visitor sees the whole flow before adding a key. Nothing here is written to the database.
// The company and people are fictional.

export const EXAMPLE_POSTING_URL = "https://jobs.example.com/northwind-labs/software-engineer";

export const EXAMPLE_POSTING = `Northwind Labs · Software Engineer, Early Career
Austin, TX (Hybrid, 3 days in office) · $110,000 - $135,000

Northwind Labs builds scheduling software for community health clinics. We're hiring an early-career
software engineer to join our Patient Experience team.

What you'll do
- Build and ship features across our React front end and Node.js / TypeScript services
- Design PostgreSQL schemas and write efficient queries
- Write tests and help keep our CI pipeline fast
- Work with designers and clinic staff to turn feedback into product improvements

What we're looking for
- 0 to 2 years of professional experience (internships count)
- Bachelor's degree in Computer Science or a related field, or equivalent experience
- Experience with TypeScript, React and SQL
- Familiarity with REST APIs and Git

Nice to have
- Experience with AWS or Docker
- Interest in healthcare

We are unable to sponsor visas for this role. Posted 2 days ago.`;

/** What the fast model would extract from the posting above (JobSignals), written out by hand. */
export const EXAMPLE_SIGNALS: JobSignals = {
  company: "Northwind Labs",
  role: "Software Engineer, Early Career",
  location: "Austin, TX",
  workMode: "Hybrid",
  salary: "$110,000 - $135,000",
  seniority: "Early career",
  mustHaveSkills: ["TypeScript", "React", "SQL", "REST APIs", "Git"],
  niceToHaveSkills: ["AWS", "Docker"],
  visaSignal: "no-sponsorship",
  visaEvidence: "We are unable to sponsor visas for this role.",
  citizenshipRequired: false,
  clearanceRequired: false,
  freshness: "within_week",
  freshnessEvidence: "Posted 2 days ago.",
  optSignal: "unknown",
  optEvidence: "",
  minYearsExperience: 0,
  degreeRequired: "none",
};

export const EXAMPLE_PROFILE: Profile = {
  ...DEFAULT_PROFILE,
  fullName: "Jordan Lee",
  email: "jordan.lee@example.com",
  location: "Austin, TX",
  linkedin: "linkedin.com/in/example",
  github: "github.com/example",
  school: "University of Texas at Austin",
  degreeType: "Bachelor's degree",
  major: "Computer Science",
  graduation: "2026-05",
  authorizedToWorkUS: "yes",
  requiresSponsorship: "no",
  visaStatus: "US citizen",
};

export const EXAMPLE_PREFERENCES: Preferences = {
  ...DEFAULT_PREFERENCES,
  experienceLevel: "new-grad",
  locations: ["metro:austin", "remote-us"],
  workModes: ["Remote", "Hybrid", "On-site"],
};

/** Jordan's "Your experience", in the format the parsers read. */
export const EXAMPLE_EXPERIENCE = `### Education
**University of Texas at Austin | Austin, TX | B.S. Computer Science | May 2026**

### Experience
**Software Engineer Intern | Brightpath Health | Austin, TX | May 2025 - Aug 2025**
- Built a React and TypeScript appointment reminder page used by **12 clinics**
- Added PostgreSQL indexes that cut the slowest report query from **4.1s to 0.6s**
- Wrote Jest tests for the scheduling REST API, raising coverage from **48% to 81%**

**Teaching Assistant, Data Structures | University of Texas at Austin | Austin, TX | Jan 2025 - May 2026**
- Held weekly office hours for **200+ students** and wrote autograded Java assignments

### Projects
**Campus Eats | Personal project | Austin, TX | Sep 2024 - Dec 2024**
- Built a Node.js and Express REST API with a React front end for student food pickups
- Deployed with Docker on AWS; **300 weekly users** at peak

### Skills inventory
- **Languages:** TypeScript, JavaScript, Java, Python, SQL
- **Frameworks:** React, Node.js, Express, Jest
- **Tools:** Git, Docker, AWS, PostgreSQL, REST APIs
`;

export const EXAMPLE_HEADER: ResumeHeader = {
  name: EXAMPLE_PROFILE.fullName,
  location: EXAMPLE_PROFILE.location,
  links: [
    { text: EXAMPLE_PROFILE.email, url: `mailto:${EXAMPLE_PROFILE.email}` },
    { text: "LinkedIn", url: "https://linkedin.com/in/example" },
    { text: "GitHub", url: "https://github.com/example" },
  ],
};

/** A tailored resume for the posting, as the engine would return it (every fact is in EXAMPLE_EXPERIENCE). */
export const EXAMPLE_RESUME: ResumeDoc = {
  education: [
    {
      school: "University of Texas at Austin",
      location: "Austin, TX",
      degree: "B.S. Computer Science",
      dates: "May 2026",
      bullets: [],
    },
  ],
  experience: [
    {
      title: "Software Engineer Intern",
      company: "Brightpath Health",
      location: "Austin, TX",
      dates: "May 2025 - Aug 2025",
      bullets: [
        "Built a **React** and **TypeScript** appointment reminder page for a healthcare scheduling product used by **12 clinics**",
        "Tuned **PostgreSQL** indexes and **SQL** queries, cutting the slowest report from **4.1s to 0.6s**",
        "Wrote **Jest** tests for the scheduling **REST API**, raising coverage from **48% to 81%**",
      ],
    },
    {
      title: "Campus Eats",
      company: "Personal project",
      location: "Austin, TX",
      dates: "Sep 2024 - Dec 2024",
      bullets: [
        "Built a **Node.js** and **Express** REST API with a **React** front end for student food pickups",
        "Deployed with **Docker** on **AWS**, serving **300 weekly users** at peak",
      ],
    },
    {
      title: "Teaching Assistant, Data Structures",
      company: "University of Texas at Austin",
      location: "Austin, TX",
      dates: "Jan 2025 - May 2026",
      bullets: ["Held weekly office hours for **200+ students** and wrote autograded **Java** assignments"],
    },
  ],
  skills: [
    { category: "Languages", items: ["TypeScript", "JavaScript", "SQL", "Java", "Python"] },
    { category: "Frameworks", items: ["React", "Node.js", "Express", "Jest"] },
    { category: "Tools", items: ["Git", "PostgreSQL", "REST APIs", "Docker", "AWS"] },
  ],
  leadership: [],
  meta: { matchedKeywords: ["TypeScript", "React", "SQL", "REST APIs", "Git", "AWS", "Docker"], gaps: [], valuesReflected: ["healthcare"] },
};
