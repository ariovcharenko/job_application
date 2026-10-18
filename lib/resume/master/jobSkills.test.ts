import { describe, expect, it } from "vitest";
import { ALEX_MASTER, SAM_MASTER } from "./__fixtures__/skillsEval";
import { cleanSkillList, MAX_PREFERRED_SKILLS, MAX_REQUIRED_SKILLS } from "./jobSkills";
import { hasSkill, matchSkills, parseSkillInventory } from "./skills";

const alexInv = parseSkillInventory(ALEX_MASTER);
const samInv = parseSkillInventory(SAM_MASTER);
const alex = (skills: string[]) => matchSkills(skills, alexInv, ALEX_MASTER);
const sam = (skills: string[]) => matchSkills(skills, samInv, SAM_MASTER);

describe("cleanSkillList", () => {
  it("splits slash pairs but keeps names that are one thing", () => {
    expect(cleanSkillList(["Python/Java", "C/C++", "HTML/CSS", "SQL/NoSQL", "Agile/Scrum"])).toEqual([
      "Python", "Java", "C", "C++", "HTML", "CSS", "SQL", "NoSQL", "Agile", "Scrum",
    ]);
    expect(cleanSkillList(["CI/CD", "A/B testing", "TCP/IP"])).toEqual(["CI/CD", "A/B testing", "TCP/IP"]);
  });

  it("strips lead-ins, years of experience and trailing 'experience'", () => {
    expect(cleanSkillList(["Experience with Docker", "3+ years of experience with Java", "Proficiency in Python", "Strong SQL skills", "Hands-on experience with AWS", "React experience"])).toEqual([
      "Docker", "Java", "Python", "SQL", "AWS", "React",
    ]);
    expect(cleanSkillList(["5+ years of professional experience", "2-4 years experience", "Python (3+ years)"])).toEqual(["Python"]);
  });

  it("drops degrees, fields of study, filler and soft skills", () => {
    expect(
      cleanSkillList(["Bachelor's degree in Computer Science", "BS/MS in Computer Science or related field", "Computer Science", "Master's degree", "Software development", "Best practices", "Strong communication skills", "Attention to detail", "Problem-solving", "Portfolio of shipped work", "Ability to learn quickly", "Teamwork"]),
    ).toEqual([]);
    // A fundamentals topic is a skill, not a degree.
    expect(cleanSkillList(["Computer science fundamentals"])).toEqual(["Computer science fundamentals"]);
  });

  it("reduces 'AWS (EC2, S3)' to the skill and keeps a category with its examples", () => {
    expect(cleanSkillList(["Experience with AWS (EC2, S3)", "Kubernetes (K8s)", "Google Cloud (GCP)", "Bug tracking (Jira)"])).toEqual(["AWS", "Kubernetes", "Google Cloud", "Bug tracking"]);
    expect(cleanSkillList(["Cloud platforms (AWS, GCP)", "Databases (e.g. PostgreSQL, MongoDB)"])).toEqual(["Cloud platforms (AWS, GCP)", "Databases (PostgreSQL, MongoDB)"]);
  });

  it("keeps 'A or B' as one item and splits comma lists", () => {
    expect(cleanSkillList(["Java or Go", "I2C, SPI, UART"])).toEqual(["Java or Go", "I2C", "SPI", "UART"]);
  });

  it("deduplicates spellings of one skill", () => {
    expect(cleanSkillList(["PostgreSQL", "Postgres", "postgres", "JavaScript", "JS", "k8s", "Kubernetes"])).toEqual(["PostgreSQL", "JavaScript", "k8s"]);
  });

  it("trims version numbers and tool words from known names only", () => {
    expect(cleanSkillList(["Java 17", "Python 3", "SIEM tools", "ROS 2", "Jenkins"])).toEqual(["Java", "Python", "SIEM", "ROS 2", "Jenkins"]);
  });

  it("splits 'X and Y' only when both are known names", () => {
    expect(cleanSkillList(["React and Redux", "Monitoring and observability", "Data structures and algorithms"])).toEqual(["React", "Redux", "Monitoring", "observability", "Data structures and algorithms"]);
  });

  it("is idempotent", () => {
    const raw = ["Experience with AWS (EC2, S3)", "Python/Java", "Cloud platforms (AWS, GCP)", "Java or Go", "3+ years of Python", "Computer science fundamentals"];
    const once = cleanSkillList(raw);
    expect(cleanSkillList(once)).toEqual(once);
  });

  it("caps a padded list", () => {
    const many = Array.from({ length: 40 }, (_, i) => `Tool${i}`);
    expect(cleanSkillList(many)).toHaveLength(MAX_REQUIRED_SKILLS);
    expect(cleanSkillList(many, "preferred")).toHaveLength(MAX_PREFERRED_SKILLS);
    expect(cleanSkillList(many)[0]).toBe("Tool0");
  });
});

describe("matching: lookalikes are not matches", () => {
  const has = (skill: string, inventory: string[], text = "") => hasSkill(skill, inventory, text);

  it("Java is not JavaScript, in either direction", () => {
    expect(has("Java", ["JavaScript"])).toBe(false);
    expect(has("JavaScript", ["Java"])).toBe(false);
    expect(has("Java", [], "- Built UIs in JavaScript")).toBe(false);
  });

  it("React is not React Native, but React Native is not implied by React either", () => {
    expect(has("React", ["React Native"])).toBe(false);
    expect(has("React", [], "- Shipped a React Native app")).toBe(false);
    expect(has("React Native", ["React"])).toBe(false);
    expect(has("React", [], "- Built a React dashboard")).toBe(true);
  });

  it("SQL and NoSQL stay apart; a SQL database implies SQL, a document database does not", () => {
    expect(has("SQL", ["NoSQL"])).toBe(false);
    expect(has("NoSQL", ["SQL"])).toBe(false);
    expect(has("SQL", ["PostgreSQL"])).toBe(true);
    expect(has("SQL", ["MongoDB"])).toBe(false);
    expect(has("NoSQL", ["MongoDB"])).toBe(true);
  });

  it("C is not C++ or C#; Java is not a prefix match", () => {
    expect(has("C", ["C++"])).toBe(false);
    expect(has("C", ["C#"])).toBe(false);
    expect(has("C++", ["C"])).toBe(false);
  });

  it("'Go' in ordinary prose is not the language", () => {
    expect(has("Go", [], "- Go through each board revision with the test team")).toBe(false);
    expect(has("Go", [], "- Go to market planning for the launch")).toBe(false);
    expect(has("Go", [], "- Built services in Go and Python")).toBe(true);
  });

  it("a skills-line label is not something she used ('ML and data:')", () => {
    expect(has("ML", [], "### Skills\n- **ML and data:** NumPy, Pandas")).toBe(false);
  });

  it("'node' in prose is not Node.js", () => {
    expect(has("Node.js", [], "- Built a ROS 2 navigation node in C++")).toBe(false);
    expect(has("Node.js", [], "- Built APIs in Node.js")).toBe(true);
  });
});

describe("matching: spellings and groups", () => {
  it("knows common synonyms", () => {
    const inv = ["JavaScript", "PostgreSQL", "Kubernetes", "GCP", "Machine Learning", "GitHub Actions"];
    const m = matchSkills(["JS", "Postgres", "k8s", "Google Cloud Platform", "ML", "CI/CD pipelines", "continuous integration"], inv, "");
    expect(m.gap).toEqual([]);
    expect(m.have).toEqual(["JS", "Postgres", "k8s", "Google Cloud Platform", "ML", "CI/CD pipelines"]);
  });

  it("a category counts when she has any member, and is a gap when she has none", () => {
    expect(alex(["modern JavaScript frameworks"]).have).toEqual(["modern JavaScript frameworks"]);
    expect(sam(["modern JavaScript frameworks"]).gap).toEqual(["modern JavaScript frameworks"]);
    expect(alex(["Cloud platforms (AWS, GCP, Azure)"]).have).toHaveLength(1);
    expect(alex(["programming languages"]).have).toHaveLength(1);
    expect(sam(["NoSQL databases"]).gap).toEqual(["NoSQL databases"]);
  });

  it("'A or B' counts when she has either", () => {
    expect(alex(["Java or Go", "Rust or Zig"])).toMatchObject({ have: ["Java or Go"], gap: ["Rust or Zig"] });
  });

  it("an implied skill needs a specific tool in her skills list", () => {
    expect(sam(["CI/CD"]).have).toEqual(["CI/CD"]);
    expect(alex(["CI/CD"]).gap).toEqual(["CI/CD"]);
    expect(alex(["Kubernetes"]).gap).toEqual(["Kubernetes"]);
  });

  it("counts coursework only for fundamentals, and only the parts it lists", () => {
    expect(alex(["Data structures and algorithms"]).have).toHaveLength(1);
    expect(sam(["Data structures and algorithms"]).gap).toHaveLength(1);
    expect(sam(["Data structures"]).have).toHaveLength(1);
    expect(alex(["Machine learning"]).gap).toEqual(["Machine learning"]);
  });
});

describe("evidence", () => {
  it("names the role or project where a skill was used", () => {
    const m = alex(["Jest", "React Testing Library", "Prometheus"]);
    expect(m.evidence?.["Jest"]).toBe("Brightloop (Software Engineer Intern)");
    expect(m.evidence?.["Prometheus"]).toBe("Taskwise (Founding Software Engineer)");
    const s = sam(["Gazebo", "Flask", "OpenCV"]);
    expect(s.evidence?.["Gazebo"]).toBe("Kestrel Robotics (Firmware Engineer)");
    expect(s.evidence?.["Flask"]).toBe("Greenhouse Monitor");
    expect(s.evidence?.["OpenCV"]).toBe("Vision and Learning Lab (Research Assistant)");
  });

  it("falls back to the skills list or coursework, and has none for a gap", () => {
    const a = alex(["TypeScript", "Data structures and algorithms", "Kubernetes"]);
    expect(a.evidence).toEqual({ TypeScript: "Skills list", "Data structures and algorithms": "Education coursework" });
    expect(a.evidence).not.toHaveProperty("Kubernetes");
  });

  it("uses the member that matched for a category or either-or item", () => {
    expect(alex(["Java or Go"]).evidence?.["Java or Go"]).toBeTruthy();
  });

  it("omits evidence when nothing matched", () => {
    expect(sam(["Kotlin"]).evidence).toBeUndefined();
  });
});
