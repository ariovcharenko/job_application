import { describe, expect, it } from "vitest";
import { EXAMPLE_RESUME, EXAMPLE_SIGNALS } from "../../example/fixture";
import type { ResumeDoc } from "../engine/schema";
import { isPastTense, lintResume, THRESHOLDS, type QualityIssue } from "./lint";
import { LINE_UNITS, segments, wrapBullet } from "./measure";
import { MASTER_DOC, masterRolesDoc, SLOP_DOC } from "./testDocs";

const SKILLS: ResumeDoc["skills"] = [
  { category: "Languages", items: ["TypeScript", "Python", "SQL"] },
  { category: "Frontend", items: ["React", "Next.js"] },
  { category: "Backend", items: ["Node.js", "REST APIs"] },
  { category: "Cloud", items: ["AWS", "Docker"] },
  { category: "Testing", items: ["Jest", "React Testing Library"] },
];

/** A one-role page with these bullets (and a 5-line skills section, so that rule stays quiet). */
function page(bullets: string[], opts: { dates?: string; skills?: ResumeDoc["skills"]; more?: ResumeDoc["experience"] } = {}): ResumeDoc {
  return {
    education: [],
    experience: [
      { title: "Software Engineer Intern", company: "Acme", location: "Remote", dates: opts.dates ?? "May 2025 - Aug 2025", bullets },
      ...(opts.more ?? []),
    ],
    skills: opts.skills ?? SKILLS,
    leadership: [],
    meta: { matchedKeywords: [], gaps: [], valuesReflected: [] },
  };
}

const role = (company: string, bullets: string[]): ResumeDoc["experience"][number] => ({
  title: "Engineer",
  company,
  location: "Remote",
  dates: "Jan 2024 - Apr 2024",
  bullets,
});

const rules = (issues: QualityIssue[]) => issues.map((i) => i.rule);
const fixes = (issues: QualityIssue[]) => issues.filter((i) => i.severity === "fix");

const STRONG = "Shipped **6 production features** to an event platform used by external attendees, with **Jest** and **React Testing Library** tests";

describe("strong bullets", () => {
  it("the spec's strong bullet produces no issues at all", () => {
    expect(lintResume(page([STRONG]))).toEqual([]);
  });

  it("the example page has no fix issues", () => {
    const issues = lintResume(EXAMPLE_RESUME, {
      jobSkills: EXAMPLE_SIGNALS.mustHaveSkills.concat(EXAMPLE_SIGNALS.niceToHaveSkills),
      requiredSkills: EXAMPLE_SIGNALS.mustHaveSkills,
    });
    expect(fixes(issues)).toEqual([]);
    // Its only note: three skills lines instead of five to seven (a judgment call, not a fix).
    expect(rules(issues)).toEqual(["skills-line-count"]);
  });

  it("the master profile's own bullets, as written, produce no issues", () => {
    expect(lintResume(masterRolesDoc())).toEqual([]);
  });

  it("a well-tailored page built from the master roles produces no issues", () => {
    expect(lintResume(MASTER_DOC)).toEqual([]);
  });

  it.each([
    "Built a **React** and **TypeScript** appointment reminder page used by **12 clinics**",
    "Led a **3-person** team that migrated billing from **MySQL** to **PostgreSQL** with zero downtime",
    "Cut CI time from **14 to 6 minutes** by caching **Docker** layers in **GitHub Actions**",
    "Re-architected the checkout service in **Go**, raising throughput to **2,000 requests/s**",
    "Co-led the design of an internal **GraphQL** gateway adopted by **4 product teams**",
    "Wrote **Python** ETL jobs on **Airflow** that load **3M rows** nightly into **Snowflake**",
    "Orchestrated **Kubernetes** deployments for **12 services** with **Helm** charts",
    "Designed a dynamic programming solver in **C++** that cut route planning time by **35%**",
  ])("no fix issues: %s", (b) => {
    expect(fixes(lintResume(page([b])))).toEqual([]);
  });
});

describe("AI and filler tells", () => {
  it("typical slop produces several fix issues", () => {
    const slop = "Spearheaded the development of a robust, cutting-edge platform, leveraging various technologies to drive impact";
    const issues = lintResume(page([slop]));
    const words = fixes(issues).filter((i) => i.rule === "buzzword").map((i) => i.quote?.toLowerCase());
    expect(words).toEqual(expect.arrayContaining(["spearheaded", "cutting-edge", "leveraging", "various", "drive impact"]));
    expect(issues.find((i) => i.quote === "robust")?.severity).toBe("consider");
    expect(issues.some((i) => i.rule === "no-substance")).toBe(true);
    for (const i of issues) expect(i.message).not.toMatch(/[—–]/);
  });

  it.each([
    ["Utilized **React** to build the dashboard", "Utilized"],
    ["Built **React** components in order to speed up onboarding by **20%**", "in order to"],
    ["Successfully migrated **3 services** to **AWS**", "Successfully"],
    ["Built seamless **React** flows for **5,000 users**", "seamless"],
    ["Delved into **Postgres** query plans to cut latency **30%**", "Delved"],
    ["Built a **React** dashboard showcasing **12 metrics**", "showcasing"],
    ["Implemented **Jest** tests, fostering a culture of quality across **3 teams**", "fostering"],
    ["Played a key role in launching a **Next.js** site for **2,000 users**", "Played a key role"],
  ])("flags %s", (bullet, word) => {
    const hit = lintResume(page([bullet])).find((i) => i.rule === "buzzword" && i.quote === word);
    expect(hit?.severity).toBe("fix");
    expect(hit?.fixHint).toContain(`Replace "${word}"`);
  });

  it("keeps technical uses of dynamic and orchestrated quiet", () => {
    const issues = lintResume(page(["Orchestrated **Docker** containers with **Kubernetes** across **3 clusters**", "Implemented dynamic routing in **Next.js** for **40 pages**"]));
    expect(issues.filter((i) => i.rule === "buzzword")).toEqual([]);
  });

  it("flags first person but not I/O or US", () => {
    expect(lintResume(page(["Built my own **React** app for **200 users**"])).find((i) => i.rule === "first-person")?.quote).toBe("my");
    expect(lintResume(page(["Reduced I/O wait on **Postgres** by **40%** for US customers"])).some((i) => i.rule === "first-person")).toBe(false);
  });

  it("flags cross-functional only when it repeats", () => {
    const one = page(["Built **React** views with a cross-functional team of **6 engineers**", STRONG]);
    expect(rules(lintResume(one))).not.toContain("cross-functional-overuse");
    const two = page([
      "Built **React** views with a cross-functional team of **6 engineers**",
      "Partnered with cross-functional stakeholders to launch **3 features** on **AWS**",
    ]);
    const hits = lintResume(two).filter((i) => i.rule === "cross-functional-overuse");
    expect(hits).toHaveLength(1);
    expect(hits[0].target).toEqual({ section: "experience", entry: 0, bullet: 1 });
  });

  it("flags trailing ', -ing' result clauses only when they are the page's pattern", () => {
    const ing = [
      "Tuned **PostgreSQL** indexes, cutting report time from **4.1s to 0.6s**",
      "Wrote **Jest** tests for the API, raising coverage to **81%**",
      "Moved image uploads to **S3**, reducing server load by **30%**",
      "Added **Redis** caching to the feed, improving p95 latency by **45%**",
      "Deployed with **Docker** on **AWS**, serving **300 weekly users**",
    ];
    const issues = lintResume(page(ing)).filter((i) => i.rule === "trailing-ing-overuse");
    expect(issues.map((i) => i.target?.bullet)).toEqual([3, 4]);
    expect(issues.every((i) => i.severity === "consider")).toBe(true);
    // Three out of six is fine (the example page has exactly that).
    expect(lintResume(page([...ing.slice(0, 3), STRONG, "Built a **Go** CLI for **5 teams**", "Led **2 interns** through **React** onboarding"])).some((i) => i.rule === "trailing-ing-overuse")).toBe(false);
  });
});

describe("opening verbs", () => {
  it("flags weak openers as fix, soft ones as consider", () => {
    const issues = lintResume(page(["Assisted with **React** migration for **4 apps**", "Contributed **12 bug fixes** to the **Node.js** API"]));
    expect(issues.find((i) => i.rule === "verb-weak")?.quote).toBe("Assisted");
    expect(issues.find((i) => i.rule === "verb-soft")?.severity).toBe("consider");
  });

  it("requires past tense in a finished role, allows present in a current one", () => {
    const b = "Build **React** dashboards for **3 clinics**";
    expect(lintResume(page([b])).find((i) => i.rule === "verb-tense")?.quote).toBe("Build");
    expect(lintResume(page([b], { dates: "Oct 2025 - Present" })).some((i) => i.rule === "verb-tense")).toBe(false);
    expect(lintResume(page(["Developing **React** dashboards for **3 clinics**"])).some((i) => i.rule === "verb-tense")).toBe(true);
    expect(lintResume(page(["Team lead for **4 engineers** building **React** apps"])).some((i) => i.rule === "verb-tense")).toBe(true);
  });

  it("knows irregular and hyphenated past tenses", () => {
    for (const w of ["Built", "Led", "Wrote", "Ran", "Drove", "Taught", "Co-led", "Re-architected", "Shipped", "Oversaw"]) expect(isPastTense(w)).toBe(true);
    for (const w of ["Build", "Leading", "Team", "Responsible", "Develops"]) expect(isPastTense(w)).toBe(false);
  });

  it("flags an opening verb used a third time, not the first two", () => {
    const doc = page(["Built a **React** app for **200 users**", "Built a **Go** CLI for **5 teams**"], {
      more: [role("Beta", ["Built **Docker** images that cut deploys to **4 minutes**", "Designed a **PostgreSQL** schema for **12 tables**"])],
    });
    const hits = lintResume(doc).filter((i) => i.rule === "verb-repeat");
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ severity: "fix", target: { section: "experience", entry: 1, bullet: 0 } });
  });

  it("does not apply verb rules to education bullets", () => {
    const doc = page([STRONG]);
    doc.education = [{ school: "Lakeside University", location: "Austin, TX", degree: "B.S.", dates: "Jun 2026", bullets: ["Relevant coursework: Data Structures, Machine Learning"] }];
    expect(lintResume(doc)).toEqual([]);
  });
});

describe("length and wrapping", () => {
  it("estimates roughly 125 to 145 characters per line", () => {
    const x = "Implemented a feature ".repeat(20);
    const firstLine = wrapBullet(x).lines[0].join(" ").length;
    expect(firstLine).toBeGreaterThan(115);
    expect(firstLine).toBeLessThan(150);
    expect(LINE_UNITS).toBeGreaterThan(55000);
  });

  it("counts bold text wider", () => {
    const text = "Word ".repeat(40).trim();
    const plainLines = wrapBullet(text).lines[0].length;
    const boldLines = wrapBullet(`**${text}**`).lines[0].length;
    expect(boldLines).toBeLessThanOrEqual(plainLines);
  });

  it("parses bold segments and ignores unpaired markers", () => {
    expect(segments("Built **React** app")).toEqual([
      { text: "Built ", bold: false },
      { text: "React", bold: true },
      { text: " app", bold: false },
    ]);
    expect(segments("Built **React app")).toEqual([{ text: "Built React app", bold: false }]);
  });

  it("flags a bullet over two lines as fix", () => {
    const long =
      "Built and deployed a **React** and **Node.js** habit tracking platform for early users with authentication, role-based permissions, background job queues, email notifications, audit logs, analytics dashboards, feature flags, rate limiting and a billing integration, serving **80+ users**";
    const hit = lintResume(page([long])).find((i) => i.rule === "too-long");
    expect(long.length).toBeGreaterThan(THRESHOLDS.maxChars);
    expect(hit?.severity).toBe("fix");
  });

  it("flags a widow line as consider, with the stranded words", () => {
    // Grow a one-liner a word at a time until exactly one word wraps onto the second line.
    const words = "for the scheduling team during peak season across every clinic site".split(" ");
    let base = "Implemented monitoring with **Prometheus** and **Grafana** and ran **k6** load tests simulating ~60 concurrent users";
    for (const word of words) {
      if (wrapBullet(base).lines.length === 2) break;
      base += ` ${word}`;
    }
    const w = wrapBullet(base);
    expect(w.lines).toHaveLength(2);
    const hit = lintResume(page([base])).find((i) => i.rule === "widow");
    expect(hit?.severity).toBe("consider");
    expect(hit?.quote).toBe(w.lines[1].join(" ").replace(/\*\*/g, ""));
  });

  it("does not flag a two-line bullet that uses its second line", () => {
    const full =
      "Implemented monitoring with **Prometheus** and **Grafana** and ran **k6** load tests simulating ~60 concurrent users, measuring p95 API latency of ~250-450 ms and holding **>99% uptime**";
    expect(wrapBullet(full).lines).toHaveLength(2);
    expect(lintResume(page([full])).some((i) => i.rule === "widow")).toBe(false);
  });

  it("flags a thin bullet as consider", () => {
    const hit = lintResume(page(["Wrote **Jest** tests"])).find((i) => i.rule === "too-thin");
    expect(hit?.severity).toBe("consider");
  });
});

describe("substance and bold", () => {
  it("asks for a technology or number when a bullet has neither", () => {
    const b = "Worked closely with designers and clinic staff to turn their feedback into product improvements";
    expect(lintResume(page([b])).find((i) => i.rule === "no-substance")?.severity).toBe("consider");
    // A named technology without bold still counts as substance.
    expect(lintResume(page(["Turned clinic staff feedback into scheduling improvements in the React front end"])).some((i) => i.rule === "no-substance")).toBe(false);
  });

  it("flags more than four bold spans", () => {
    const b = "Built **React**, **Next.js**, **Node.js**, **PostgreSQL** and **Docker** services for **12 clinics**";
    expect(lintResume(page([b])).find((i) => i.rule === "bold-too-many")?.severity).toBe("fix");
  });

  it("flags bolded phrases and verbs, not metrics with units", () => {
    const issues = lintResume(page(["**Improved** latency with **Redis caching across the whole platform** for **p95 ~250-450 ms**"]));
    const quotes = issues.filter((i) => i.rule === "bold-phrase" || i.rule === "bold-verb").map((i) => i.quote);
    expect(quotes).toEqual(["Improved", "Redis caching across the whole platform"]);
  });

  it("flags bold outside bullets", () => {
    const doc = page([STRONG], { skills: [{ category: "**Languages**", items: ["TypeScript"] }, ...SKILLS.slice(1)] });
    expect(lintResume(doc).find((i) => i.rule === "bold-outside-bullets")?.target).toEqual({ section: "skills", entry: 0 });
  });

  it("notes a role with no number anywhere, but not a role with one", () => {
    const doc = page([STRONG], { more: [role("Beta", ["Built the **React** admin console for support staff"])] });
    const hits = lintResume(doc).filter((i) => i.rule === "role-unquantified");
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ severity: "consider", target: { section: "experience", entry: 1 } });
  });
});

describe("repetition", () => {
  it("notes a technology bolded in more than three bullets", () => {
    const doc = page([
      "Built **React** views for **3 clinics**",
      "Refactored **React** state into hooks, cutting renders by **40%**",
      "Wrote **React** tests with **Jest** covering **80%** of views",
      "Migrated **React** routing to **Next.js** for **20 pages**",
    ]);
    const hit = lintResume(doc).find((i) => i.rule === "tech-repeat");
    expect(hit).toMatchObject({ severity: "consider", quote: "React" });
  });

  it("flags near-duplicate bullets across roles", () => {
    const a = "Built a **React** dashboard that tracks clinic appointment reminders for **12 clinics**";
    const b = "Built a **React** dashboard that tracks appointment reminders for clinic staff at **8 clinics**";
    const hit = lintResume(page([a], { more: [role("Beta", [b])] })).find((i) => i.rule === "near-duplicate");
    expect(hit?.severity).toBe("fix");
    expect(hit?.target).toEqual({ section: "experience", entry: 1, bullet: 0 });
    expect(hit?.message).toContain("Acme, bullet 1");
  });

  it("notes a repeated result phrase", () => {
    const doc = page([
      "Automated the weekly report with **Python**, reducing manual data entry work for **4 analysts**",
      "Built a **React** intake form for patient records, reducing manual data entry for front desk staff",
    ]);
    const hit = lintResume(doc).find((i) => i.rule === "phrase-repeat");
    expect(hit).toMatchObject({ severity: "consider", quote: "reducing manual data entry" });
  });

  it("does not treat shared technology names as a repeated phrase", () => {
    expect(lintResume(MASTER_DOC).some((i) => i.rule === "phrase-repeat")).toBe(false);
  });

  it("notes mixed trailing periods", () => {
    const hit = lintResume(page([STRONG, "Built a **Go** CLI for **5 teams**."])).find((i) => i.rule === "trailing-period");
    expect(hit?.severity).toBe("consider");
  });
});

describe("keyword coverage", () => {
  it("lists have-skills missing from the page, with synonyms counted", () => {
    const hit = lintResume(page([STRONG]), { jobSkills: ["React", "Postgres", "Kubernetes", "RESTful APIs", "Teamwork"] }).find((i) => i.rule === "keywords-missing");
    expect(hit?.severity).toBe("consider");
    // RESTful APIs matches "REST APIs"; Teamwork is a soft skill and is ignored.
    expect(hit?.message).toContain("Missing: Postgres, Kubernetes.");
    expect(hit?.message).toContain("2 of 4");
    expect(hit?.fixHint).toContain("Postgres, Kubernetes");
  });

  it("stays quiet when every have-skill is on the page", () => {
    expect(lintResume(page([STRONG]), { jobSkills: ["React", "TypeScript", "Jest"] }).some((i) => i.rule === "keywords-missing")).toBe(false);
  });

  it("flags a top required skill that's on the page but not in the top third", () => {
    const doc = page(["Built **Next.js** pages for **3 clinics**"], {
      skills: [{ category: "Languages", items: ["Python"] }, ...SKILLS.slice(1), { category: "Data", items: ["Kafka"] }],
      more: [role("Beta", ["Streamed **Kafka** events for **2M users**"])],
    });
    const hit = lintResume(doc, { requiredSkills: ["Kafka", "Python", "Next.js", "Rust"] }).find((i) => i.rule === "keywords-not-top");
    expect(hit?.message).toContain("Kafka");
    expect(hit?.message).not.toContain("Python");
    // Rust is a gap (nowhere on the page) and is 4th anyway: never nagged about here.
    expect(hit?.message).not.toContain("Rust");
  });
});

describe("skills section", () => {
  it("flags duplicates and soft skills as fix, office filler as consider", () => {
    const issues = lintResume(SLOP_DOC);
    expect(issues.find((i) => i.rule === "skills-duplicate")).toMatchObject({ severity: "fix", quote: "Python", target: { section: "skills", entry: 1 } });
    expect(issues.find((i) => i.rule === "skills-soft")).toMatchObject({ severity: "fix", quote: "Communication" });
    expect(issues.find((i) => i.rule === "skills-filler")).toMatchObject({ severity: "consider", quote: "Microsoft Office" });
  });

  it("counts synonyms as duplicates", () => {
    const doc = page([STRONG], { skills: [...SKILLS, { category: "Data", items: ["Postgres", "PostgreSQL"] }] });
    expect(lintResume(doc).find((i) => i.rule === "skills-duplicate")?.quote).toBe("PostgreSQL");
  });

  it("notes a line count outside 5 to 7", () => {
    expect(lintResume(page([STRONG], { skills: SKILLS.slice(0, 3) })).find((i) => i.rule === "skills-line-count")?.severity).toBe("consider");
    expect(lintResume(page([STRONG], { skills: [...SKILLS, ...SKILLS.slice(0, 3).map((l) => ({ ...l, category: `${l.category} 2`, items: [`${l.items[0]}x`] }))] })).some((i) => i.rule === "skills-line-count")).toBe(true);
  });
});

describe("issue shape", () => {
  it("gives stable, unique ids and plain messages", () => {
    const a = lintResume(SLOP_DOC);
    const b = lintResume(SLOP_DOC);
    expect(a.map((i) => i.id)).toEqual(b.map((i) => i.id));
    expect(new Set(a.map((i) => i.id)).size).toBe(a.length);
    for (const i of a) {
      expect(i.message).not.toMatch(/[—–]/);
      expect(i.fixHint).not.toMatch(/[—–]/);
      expect(i.fixHint.length).toBeGreaterThan(10);
    }
  });

  it("lists fix issues before consider issues", () => {
    const sev = lintResume(SLOP_DOC).map((i) => i.severity);
    expect(sev.indexOf("consider")).toBeGreaterThan(sev.lastIndexOf("fix"));
  });

  it("the slop page produces many fix issues", () => {
    expect(fixes(lintResume(SLOP_DOC)).length).toBeGreaterThanOrEqual(10);
  });
});
