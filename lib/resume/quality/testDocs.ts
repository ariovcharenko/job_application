// Documents for the quality linter's tests (lint.test.ts, summary.test.ts). Not used by the app.

import { MASTER } from "../engine/__fixtures__/master";
import type { ResumeDoc } from "../engine/schema";
import { cleanTitle, parseMasterExperiences } from "../master/experiences";

const META = { matchedKeywords: [], gaps: [], valuesReflected: [] };

const EDUCATION: ResumeDoc["education"] = [
  {
    school: "Lakeside University",
    location: "Austin, TX",
    degree: "Bachelor of Computer Science, Minor in Data Science",
    dates: "Sep 2022 - Jun 2026",
    bullets: ["Relevant coursework: Cloud Computing, Data Structures & Algorithms, Machine Learning"],
  },
];

const SKILLS: ResumeDoc["skills"] = [
  { category: "Languages", items: ["TypeScript", "JavaScript", "Java", "Python", "Go", "HTML/CSS"] },
  { category: "Frontend", items: ["React", "React Native", "Next.js", "Tailwind CSS"] },
  { category: "Backend", items: ["Node.js", "Spring Boot", "REST APIs", "Prisma ORM"] },
  { category: "Databases & Cloud", items: ["PostgreSQL", "MySQL", "AWS (Elastic Beanstalk, S3, RDS)", "Docker"] },
  { category: "Testing & Monitoring", items: ["Jest", "React Testing Library", "k6", "Prometheus", "Grafana"] },
  { category: "AI", items: ["OpenAI API", "LLMs", "prompt engineering"] },
];

/** The master profile's roles with their bullets exactly as written (periods dropped), no bold. */
export function masterRolesDoc(): ResumeDoc {
  return {
    education: EDUCATION,
    experience: parseMasterExperiences(MASTER).map((m) => ({
      title: cleanTitle(m.title),
      company: m.company,
      location: m.location,
      dates: m.dates,
      bullets: m.block
        .split("\n")
        .filter((l) => l.startsWith("- "))
        .map((l) => l.slice(2).trim().replace(/\.$/, "")),
    })),
    skills: SKILLS,
    leadership: [{ role: "Robotics Club, Team Lead at Lakeside University", dates: "Oct 2023 - Present" }],
    meta: META,
  };
}

/** The same roles as a good tailored page would write them: her bolding rules, no filler. */
export const MASTER_DOC: ResumeDoc = {
  ...masterRolesDoc(),
  experience: [
    {
      title: "Software Engineer Intern",
      company: "Brightloop",
      location: "Austin, TX",
      dates: "May 2026 - Aug 2026",
      bullets: [
        "Shipped **6 production features** to an event platform used by external attendees, with **Jest** and **React Testing Library** tests",
        "Wrote unit, component, and contract tests alongside every feature using **Jest** and **React Testing Library**",
      ],
    },
    {
      title: "Founding Software Engineer",
      company: "Taskwise",
      location: "Remote",
      dates: "Oct 2025 - Present",
      bullets: [
        "Built and deployed a habit tracking platform serving **80+ early users**, reducing manual goal planning time by **~35%**",
        "Implemented monitoring with **Prometheus** and **Grafana** and ran **k6** load tests simulating ~60 concurrent users, measuring p95 API latency of ~250-450 ms and holding **>99% uptime**",
      ],
    },
    {
      title: "Founding Software Engineer, AI Product",
      company: "Query Insights App",
      location: "Remote",
      dates: "Apr 2025 - May 2025",
      bullets: ["Improved **LLM** answer accuracy to **97%** through prompt refinement and edge-case handling"],
    },
  ],
};

/** Typical generated filler, for the "bad" side of the tests. */
export const SLOP_DOC: ResumeDoc = {
  education: EDUCATION,
  experience: [
    {
      title: "Software Engineer Intern",
      company: "Acme",
      location: "Remote",
      dates: "May 2025 - Aug 2025",
      bullets: [
        "Spearheaded the development of a robust, cutting-edge platform, leveraging various technologies to drive impact",
        "Responsible for working on various features in order to improve the user experience",
        "Helped the team with testing",
        "Utilized **React** to build seamless user interfaces, ensuring a great experience for our users",
      ],
    },
  ],
  skills: [
    { category: "Languages", items: ["JavaScript", "Python"] },
    { category: "Other", items: ["Communication", "Microsoft Office", "Python"] },
  ],
  leadership: [],
  meta: META,
};
