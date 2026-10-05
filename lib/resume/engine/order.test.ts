import { describe, expect, it } from "vitest";
import type { ResumeDoc } from "./schema";
import { dateRangeEnd, sortNewestFirst, validateResume } from "./validate";
import { keywordComments } from "./pipeline";

// A second, made-up candidate whose experience is shaped differently from the demo one: other
// section names, numeric and year-only dates, a current role, a capstone project. The engine's
// checks must work for any experience, not one person's layout.
const OTHER = `### Work History
**Data Analyst | Marlow Insurance | Chicago, IL | 03/2024 - Present**
- Built Python and SQL pipelines that cut weekly reporting time by 70%
- Designed Tableau dashboards for 4 claims teams

**Research Intern | Prairie Health Lab | Remote | 2021-2022**
- Cleaned 2 million patient records with pandas for a readmission model

**Analytics Intern | Northgate Retail | Chicago, IL | Summer 2023**
- Wrote dbt models in Snowflake for store-level sales reporting

### Selected Projects
**Capstone | FareWatch | Chicago, IL | Spring 2024**
- Forecast transit ridership with scikit-learn, within 8% error

### Skills
- **Languages:** Python, SQL, R
- **Tools:** Tableau, dbt, Snowflake, pandas, scikit-learn
`;

const entry = (title: string, company: string, location: string, dates: string, bullets: string[]) => ({ title, company, location, dates, bullets });

function page(): ResumeDoc {
  return {
    education: [],
    experience: [
      entry("Research Intern", "Prairie Health Lab", "Remote", "2021 - 2022", ["Cleaned **2 million** patient records with **pandas** for a readmission model"]),
      entry("Data Analyst", "Marlow Insurance", "Chicago, IL", "03/2024 - Present", ["Built **Python** and **SQL** pipelines that cut weekly reporting time by **70%**"]),
      entry("Analytics Intern", "Northgate Retail", "Chicago, IL", "Summer 2023", ["Wrote **dbt** models in **Snowflake** for store-level sales reporting"]),
    ],
    // The model wrote the project's name as its title.
    projects: [entry("FareWatch", "FareWatch", "Chicago, IL", "Spring 2024", ["Forecast transit ridership with **scikit-learn**, within **8%** error"])],
    skills: [{ category: "Languages", items: ["Python", "SQL", "R"] }],
    leadership: [],
    meta: { matchedKeywords: [], gaps: [], valuesReflected: [] },
  };
}

describe("dateRangeEnd", () => {
  it("reads the formats people write", () => {
    expect(dateRangeEnd("Jun 2025 - Sep 2025")).toBe(2025 * 12 + 9);
    expect(dateRangeEnd("June 2025 – Present")).toBe(Number.MAX_SAFE_INTEGER);
    expect(dateRangeEnd("05/2023 - 08/2023")).toBe(2023 * 12 + 8);
    expect(dateRangeEnd("2022-2024")).toBe(2024 * 12 + 12);
    expect(dateRangeEnd("Summer 2024")).toBe(2024 * 12 + 7);
    expect(dateRangeEnd("Oct 2024")).toBe(2024 * 12 + 10);
    expect(dateRangeEnd("Current")).toBe(Number.MAX_SAFE_INTEGER);
    expect(dateRangeEnd("")).toBeNull();
  });
});

describe("sortNewestFirst", () => {
  it("puts the current role first and keeps ties in the given order", () => {
    const out = sortNewestFirst([{ dates: "2021 - 2022" }, { dates: "Jan 2023 - Present" }, { dates: "Mar 2022 - Dec 2022" }]);
    expect(out.entries.map((e) => e.dates)).toEqual(["Jan 2023 - Present", "Mar 2022 - Dec 2022", "2021 - 2022"]);
    expect(out.changed).toBe(true);
  });

  it("leaves the order alone when any date can't be read", () => {
    const list = [{ dates: "a while ago" }, { dates: "2024 - Present" }];
    expect(sortNewestFirst(list)).toEqual({ entries: list, changed: false });
  });
});

describe("validateResume on a differently shaped experience", () => {
  it("orders roles newest first and restores a project's own label instead of flagging it", () => {
    const r = validateResume(page(), OTHER);
    expect(r.doc.experience.map((e) => e.company)).toEqual(["Marlow Insurance", "Northgate Retail", "Prairie Health Lab"]);
    expect(r.doc.projects?.[0].title).toBe("Capstone");
    expect(r.flags.filter((f) => f.kind === "employer")).toEqual([]);
    expect(r.fixes.join(" ")).toMatch(/newest first/);
  });
});

describe("keywordComments on a differently shaped experience", () => {
  it("asks for a skill the role's own text shows, and never for one it doesn't", () => {
    const doc = page();
    doc.experience[1].bullets = ["Built pipelines that cut weekly reporting time by **70%**"];
    const comments = keywordComments(doc, OTHER, ["SQL", "Tableau", "R"]);
    // SQL and Tableau are in Marlow's own text; R is only in the skills list, so it stays in Skills.
    expect(comments).toHaveLength(1);
    expect(comments[0].target).toEqual({ section: "experience", entry: 1 });
    expect(comments[0].note).toMatch(/SQL, Tableau/);
    expect(comments[0].note).not.toMatch(/\bR\b,/);
  });
});
