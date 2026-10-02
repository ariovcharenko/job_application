import { describe, expect, it } from "vitest";
import { MASTER } from "./__fixtures__/master";
import type { ResumeDoc } from "./schema";
import { applyApprovals, fixBoldMarkers, fixDashes, numbersIn, validateResume, normalizeFlagMessage } from "./validate";

function doc(overrides: Partial<ResumeDoc> = {}): ResumeDoc {
  return {
    education: [
      {
        school: "Lakeside University",
        location: "Austin, TX",
        degree: "Bachelor of Computer Science, Minor in Data Science",
        dates: "Sep 2022 - Jun 2026",
        bullets: ["Relevant coursework: Cloud Computing, Machine Learning"],
      },
    ],
    experience: [
      {
        title: "Software Engineer Intern",
        company: "Brightloop",
        location: "Austin, TX",
        dates: "May 2026 - Aug 2026",
        bullets: ["Shipped **6 production features** with **React**", "Wrote tests with **Jest**"],
      },
    ],
    skills: [{ category: "Languages", items: ["TypeScript", "Python"] }],
    leadership: [],
    meta: { matchedKeywords: [], gaps: [], valuesReflected: [] },
    ...overrides,
  };
}

describe("fixDashes", () => {
  it("turns spaced em/en dashes and double hyphens into a spaced hyphen", () => {
    expect(fixDashes("May 2026 – Aug 2026").text).toBe("May 2026 - Aug 2026");
    expect(fixDashes("fast — and reliable").text).toBe("fast - and reliable");
    expect(fixDashes("a -- b").text).toBe("a - b");
  });

  it("turns unspaced ones into a plain hyphen and counts every fix", () => {
    const r = fixDashes("end–to–end, p95 300—450 ms");
    expect(r.text).toBe("end-to-end, p95 300-450 ms");
    expect(r.count).toBe(3);
  });
});

describe("fixBoldMarkers", () => {
  it("keeps balanced markers and drops unbalanced ones", () => {
    expect(fixBoldMarkers("**React** app")).toBe("**React** app");
    expect(fixBoldMarkers("**React app")).toBe("React app");
  });
});

describe("numbersIn", () => {
  it("finds every number, including inside metrics", () => {
    expect(numbersIn("**~35%** faster, **p95 ~250-450 ms**, **50+** users")).toEqual(["35", "95", "250", "450", "50"]);
  });
});

describe("validateResume", () => {
  it("passes a resume built only from the master profile, with no flags", () => {
    const r = validateResume(doc(), MASTER);
    expect(r.flags).toEqual([]);
  });

  it("fixes dashes everywhere and reports it", () => {
    const r = validateResume(doc({ experience: [{ ...doc().experience[0], dates: "May 2026 — Aug 2026" }] }), MASTER);
    expect(r.doc.experience[0].dates).toBe("May 2026 - Aug 2026");
    expect(r.fixes[0]).toMatch(/Replaced 1 dash/);
  });

  it("flags a skill that isn't in the master profile", () => {
    const r = validateResume(doc({ skills: [{ category: "Cloud", items: ["AWS", "Kubernetes"] }] }), MASTER);
    expect(r.flags).toEqual([expect.objectContaining({ kind: "skill", target: { section: "skills", line: 0, item: 1 } })]);
  });

  it("flags a bullet with a number the master profile doesn't have", () => {
    const d = doc();
    d.experience[0].bullets.push("Cut load time by **73%**");
    const r = validateResume(d, MASTER);
    expect(r.flags).toEqual([expect.objectContaining({ kind: "number", target: { section: "experience", entry: 0, bullet: 2 } })]);
  });

  it("flags an invented employer or wrong dates", () => {
    const r = validateResume(
      doc({ experience: [{ ...doc().experience[0], company: "Google", dates: "Jan 2024 - Aug 2026" }] }),
      MASTER,
    );
    expect(r.flags[0]).toMatchObject({ kind: "employer", target: { section: "experience", entry: 0 } });
    expect(r.flags[0].message).toMatch(/Google/);
    expect(r.flags[0].message).toMatch(/Jan 2024/);
  });

  it("accepts the alternate title listed in the master profile", () => {
    const r = validateResume(
      doc({ experience: [{ title: "Product & UX Engineer", company: "Taskwise", location: "Remote", dates: "Oct 2025 - Present", bullets: [] }] }),
      MASTER,
    );
    expect(r.flags).toEqual([]);
  });

  it("strips bold from titles and skills; only bullets may be bold", () => {
    const r = validateResume(doc({ skills: [{ category: "**Languages**", items: ["**TypeScript**"] }] }), MASTER);
    expect(r.doc.skills[0]).toEqual({ category: "Languages", items: ["TypeScript"] });
  });
});

describe("validateResume: tools inside bullets", () => {
  const withBullet = (b: string, entry = 0) => {
    const d = doc();
    d.experience[entry].bullets = [b];
    return validateResume(d, MASTER);
  };

  it("flags each technology in a bullet that the master profile doesn't have, targeting the bullet", () => {
    const r = withBullet("Built services with **Kubernetes** and **Redis**");
    const skills = r.flags.filter((f) => f.kind === "skill");
    expect(skills.map((f) => f.message.split(" ")[0])).toEqual(['"Kubernetes"', '"Redis"']);
    expect(skills[0].target).toEqual({ section: "experience", entry: 0, bullet: 0 });
  });

  it("finds known technology names even when they aren't bold", () => {
    const r = withBullet("Deployed the service to Kubernetes");
    expect(r.flags).toEqual([expect.objectContaining({ kind: "skill", target: { section: "experience", entry: 0, bullet: 0 } })]);
  });

  it("passes tools she has, true synonyms, and ordinary bold phrases", () => {
    expect(withBullet("Built a **design system** in **React** with **Jest** tests").flags).toEqual([]);
    expect(withBullet("Wrote tests in **React Testing Library** for the **checkout** flow").flags).toEqual([]);
    expect(withBullet("**Owned** the matchmaking feature end-to-end").flags).toEqual([]);
  });

  it("notes, without removing, a skill she has that this role's own text never mentions", () => {
    // Prisma ORM and REST are on her skills list but not in the Brightloop role: true, so it stays
    // on the page with one note to check, instead of the bullet silently vanishing.
    const r = withBullet("Stored records with **Prisma ORM** behind **RESTful web services**");
    expect(r.flags).toHaveLength(1);
    expect(r.flags[0]).toMatchObject({ kind: "skill", severity: "note", target: { section: "experience", entry: 0, bullet: 0 } });
    expect(r.flags[0].message).toMatch(/"Prisma ORM", "RESTful web services" are in your experience, but not in this role/);
    expect(applyApprovals(r.doc, r.flags, new Set()).experience[0].bullets).toHaveLength(1);
  });

  it("blocks a technology that appears nowhere in her experience", () => {
    const r = withBullet("Built services with **Kubernetes**");
    expect(r.flags.map((f) => f.severity)).toEqual(["block"]);
    expect(applyApprovals(r.doc, r.flags, new Set()).experience[0].bullets).toEqual([]);
  });

  it("notes claims the role's own text doesn't make, without removing the bullet", () => {
    const r = withBullet("Shipped features for **client** workflows with **external partners**");
    expect(r.flags.map((f) => f.kind)).toContain("claim");
    expect(r.flags.find((f) => f.kind === "claim")?.severity).toBe("note");
    expect(r.flags.find((f) => f.kind === "claim")?.message).toMatch(/client", "partner/);
    expect(withBullet("Shipped **6 production features** to the checkout platform").flags).toEqual([]);
  });

  it("checks education bullets too, but accepts coursework the education entry lists", () => {
    const d = doc();
    d.education[0].bullets = ["Studied **Machine Learning** and **Cloud Computing**", "Built a **Kubernetes** lab"];
    const r = validateResume(d, MASTER);
    expect(r.flags).toEqual([expect.objectContaining({ kind: "skill", target: { section: "education", entry: 0, bullet: 1 } })]);
  });

  it("drops the bullet unless every blocked tool in it is kept", () => {
    const d = doc();
    d.experience[0].bullets = ["Built services with **Kubernetes** and **Redis**", "Wrote tests with **Jest**"];
    const { doc: v, flags } = validateResume(d, MASTER);
    expect(applyApprovals(v, flags, new Set([flags[0].id])).experience[0].bullets).toEqual(["Wrote tests with **Jest**"]);
    expect(applyApprovals(v, flags, new Set(flags.map((f) => f.id))).experience[0].bullets).toHaveLength(2);
  });
});

describe("validateResume: role headers", () => {
  const brightloop = (over: Partial<ResumeDoc["experience"][number]>) => {
    const r = validateResume(doc({ experience: [{ ...doc().experience[0], ...over }] }), MASTER);
    return r.flags.filter((f) => f.kind === "employer");
  };

  it("flags a title that belongs to a different role", () => {
    expect(brightloop({ title: "Founding Software Engineer" })[0].message).toMatch(/title "Founding Software Engineer"/);
  });

  it("writes the role's own dates and location from her experience instead of trusting the model's", () => {
    const fixed = (over: Partial<ResumeDoc["experience"][number]>) =>
      validateResume(doc({ experience: [{ ...doc().experience[0], ...over }] }), MASTER);
    for (const over of [{ dates: "Oct 2025 - Present" }, { dates: "Summer 2026" }, { dates: "05/2026 - 08/2026" }, { location: "San Francisco, CA" }]) {
      const r = fixed(over);
      expect(r.flags.filter((f) => f.kind === "employer")).toEqual([]);
      expect(r.doc.experience[0]).toMatchObject({ dates: "May 2026 - Aug 2026", location: "Austin, TX" });
    }
  });

  it("accepts the main or the alt title, and never prints the alt-title note", () => {
    const taskwise = { company: "Taskwise", location: "Remote", dates: "Oct 2025 - Present", bullets: [] };
    for (const title of ["Founding Software Engineer", "Product & UX Engineer", "Founding Software Engineer (alt. title: Product & UX Engineer)"]) {
      const r = validateResume(doc({ experience: [{ title, ...taskwise }] }), MASTER);
      expect(r.flags).toEqual([]);
      expect(r.doc.experience[0].title).not.toMatch(/alt\. title/);
    }
  });

  it("puts spaces around the hyphen in date ranges", () => {
    const r = validateResume(doc({ experience: [{ ...doc().experience[0], dates: "May 2026-Aug 2026" }] }), MASTER);
    expect(r.doc.experience[0].dates).toBe("May 2026 - Aug 2026");
    expect(r.flags).toEqual([]);
  });
});

describe("validateResume: education and leadership", () => {
  const edu = (over: Partial<ResumeDoc["education"][number]>) =>
    validateResume(doc({ education: [{ ...doc().education[0], ...over }] }), MASTER).flags.filter((f) => f.kind === "education");

  it("flags a degree, location or dates the master profile doesn't have", () => {
    expect(edu({ degree: "Master of Science in Computer Science" })).toHaveLength(1);
    expect(edu({ location: "San Francisco, CA" })).toHaveLength(1);
    expect(edu({ dates: "2023 - 2027" })).toHaveLength(1);
    expect(edu({ dates: "Sep 2022-Jun 2026" })).toEqual([]);
  });

  it("flags leadership roles or dates not in the leadership section, and drops them unless ticked", () => {
    const leadership = [
      { role: "Robotics Club, Team Lead", dates: "Oct 2023 - Present" },
      { role: "President, ACM Chapter", dates: "Oct 2023 - Present" },
      { role: "Robotics Club", dates: "Jan 2020 - Present" },
    ];
    const { doc: v, flags } = validateResume(doc({ leadership }), MASTER);
    expect(flags.map((f) => f.target)).toEqual([
      { section: "leadership", entry: 1 },
      { section: "leadership", entry: 2 },
    ]);
    expect(flags.every((f) => f.kind === "leadership")).toBe(true);
    expect(applyApprovals(v, flags, new Set()).leadership).toEqual([leadership[0]]);
    expect(applyApprovals(v, flags, new Set([flags[0].id])).leadership).toHaveLength(2);
  });

  it("doesn't count leadership text as a skill", () => {
    const r = validateResume(doc({ skills: [{ category: "Other", items: ["Robotics Club"] }] }), MASTER);
    expect(r.flags).toEqual([expect.objectContaining({ kind: "skill", target: { section: "skills", line: 0, item: 0 } })]);
  });
});

describe("validateResume: numbers per role", () => {
  const nums = (b: string) => {
    const d = doc();
    d.experience[0].bullets = [b];
    return validateResume(d, MASTER).flags.filter((f) => f.kind === "number");
  };

  it("flags a number that exists in the master profile but under a different role", () => {
    expect(nums("Improved accuracy to **97%**")).toHaveLength(1);
    expect(nums("Cut planning time by **~35%**")).toHaveLength(1);
    expect(nums("Shipped **6 production features**")).toEqual([]);
  });

  it("flags number words the role's master entry doesn't use", () => {
    expect(nums("Built tools for **six** teams")[0].message).toMatch(/six/);
    expect(nums("Doubled throughput for thousands of users")[0].message).toMatch(/doubled.*thousands/i);
  });

  it("allows tool names with digits from anywhere in the master profile", () => {
    expect(nums("Tracked **p95** latency for **S3** uploads")).toEqual([]);
  });
});

describe("validateResume: skill synonyms", () => {
  it("doesn't flag true synonyms of skills she has", () => {
    const r = validateResume(doc({ skills: [{ category: "Cloud", items: ["Amazon S3", "Large Language Models (LLMs)", "RESTful web services"] }] }), MASTER);
    expect(r.flags).toEqual([]);
  });
});

describe("applyApprovals", () => {
  it("removes unapproved flagged content and keeps approved content", () => {
    const d = doc({ skills: [{ category: "Cloud", items: ["AWS", "Kubernetes"] }] });
    d.experience[0].bullets.push("Cut load time by **73%**");
    const { doc: v, flags } = validateResume(d, MASTER);

    const none = applyApprovals(v, flags, new Set());
    expect(none.skills[0].items).toEqual(["AWS"]);
    expect(none.experience[0].bullets).toHaveLength(2);

    const all = applyApprovals(v, flags, new Set(flags.map((f) => f.id)));
    expect(all.skills[0].items).toEqual(["AWS", "Kubernetes"]);
    expect(all.experience[0].bullets).toHaveLength(3);
  });

  it("drops a whole experience entry whose employer is unverified", () => {
    const { doc: v, flags } = validateResume(doc({ experience: [{ ...doc().experience[0], company: "Google" }] }), MASTER);
    expect(applyApprovals(v, flags, new Set()).experience).toEqual([]);
  });
});

describe("normalizeFlagMessage", () => {
  it("maps ticks saved with the old wording to the new one", () => {
    expect(normalizeFlagMessage('"Go" isn\'t in your master profile.')).toBe('"Go" isn\'t in your experience.');
    expect(normalizeFlagMessage('"X" isn\'t in your master profile\'s leadership section.')).toBe('"X" isn\'t in your experience\'s leadership section.');
  });
});

describe("role headers are corrected, not dropped, when they only reword her own facts", () => {
  const master = `### Experience

**Founding Software Engineer (alt. title: Product & UX Engineer) | Taskwise | Remote | Oct 2025 - Present**
- Built a platform serving 80+ users.

### Skills
- Languages: TypeScript`;
  const doc = (title: string, extra: Partial<{ dates: string; location: string }> = {}) => ({
    education: [],
    experience: [{ title, company: "Taskwise", location: extra.location ?? "Remote (US)", dates: extra.dates ?? "Oct. 2025 - present", bullets: ["Built a platform serving **80+ users**."] }],
    skills: [{ category: "Languages", items: ["TypeScript"] }],
    leadership: [],
    meta: { matchedKeywords: [], gaps: [], valuesReflected: [] },
  });

  it("turns 'Main (Alt)' into the leading title and copies dates and location", () => {
    const r = validateResume(doc("Founding Software Engineer (Product & UX Engineer)"), master);
    expect(r.flags).toEqual([]);
    expect(r.doc.experience[0]).toMatchObject({ title: "Founding Software Engineer", location: "Remote", dates: "Oct 2025 - Present" });
    expect(r.fixes.join(" ")).toContain("exact title, dates and location");
  });

  it("keeps the alt title when that's what the model chose", () => {
    const r = validateResume(doc("Product & UX Engineer"), master);
    expect(r.flags).toEqual([]);
    expect(r.doc.experience[0].title).toBe("Product & UX Engineer");
  });

  it("still flags a title that isn't hers", () => {
    const r = validateResume(doc("Engineering Manager"), master);
    expect(r.flags.some((f) => f.kind === "employer")).toBe(true);
  });
});

describe("validateResume: confirmed skills with usage notes", () => {
  const bullet = "Built an onboarding screen in **Kotlin** for the checkout flow";
  const withRole = (master: string) => {
    const d = doc();
    d.experience[0].bullets = [bullet];
    return validateResume(d, master).flags.filter((f) => f.kind === "skill");
  };
  it("allows a confirmed skill in a bullet only for the role its note names", () => {
    const listed = MASTER.replace("- **Testing & Monitoring:**", "- **Additional:** Kotlin\n- **Testing & Monitoring:**");
    expect(withRole(listed)).toHaveLength(1);
    expect(withRole(`${listed}\n\n### Usage notes\n- Kotlin: Android screens at Brightloop\n`)).toEqual([]);
    expect(withRole(`${listed}\n\n### Usage notes\n- Kotlin: a class project\n`)).toHaveLength(1);
    // Listed but not in this role: a note to check, never a deletion.
    expect(withRole(listed).map((f) => f.severity)).toEqual(["note"]);
  });

  it("accepts a skill placed in this exact role from the tailoring screen (stored by role, not free text)", () => {
    const listed = MASTER.replace("- **Testing & Monitoring:**", "- **Additional:** Kotlin\n- **Testing & Monitoring:**");
    expect(withRole(`${listed}\n\n### Usage notes\n- Kotlin @ Brightloop | Software Engineer Intern: used in this role\n`)).toEqual([]);
    // Placed in another role: still only a note here.
    expect(withRole(`${listed}\n\n### Usage notes\n- Kotlin @ Some Other Co | Engineer: used in this role\n`).map((f) => f.severity)).toEqual(["note"]);
  });

  it("doesn't flag a skills-line item her experience shows only in a bullet", () => {
    const d = doc();
    d.skills = [{ category: "Tools", items: ["Docker"] }];
    const notListed = MASTER.replace("GCP, Docker, Railway", "GCP, Railway");
    expect(notListed).not.toMatch(/Docker/);
    const inBullet = notListed.replace("- Wrote", "- Containerized the API with Docker\n- Wrote");
    expect(validateResume(d, inBullet).flags.filter((f) => f.target.section === "skills")).toEqual([]);
    expect(validateResume(d, notListed).flags.filter((f) => f.target.section === "skills")).toEqual([expect.objectContaining({ severity: "block" })]);
  });
});
