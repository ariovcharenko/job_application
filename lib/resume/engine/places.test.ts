import { describe, expect, it } from "vitest";
import { placeOptions, placeTarget } from "./places";
import type { ResumeDoc } from "./schema";

const master = `### Experience

**Software Engineer Intern | Northwind, Search Team | Remote | May 2026 - Aug 2026**
- Built a ranking service.

**Founding Engineer | Taskwise | Remote | Oct 2025 - Present**
- Built a platform.

### Projects

**DemoDeck | Personal | Jan 2025**
- Made slides.`;

const entry = (company: string, title = "x") => ({ title, company, location: "", dates: "", bullets: ["a"] });
const page = (experience: ReturnType<typeof entry>[], projects: ReturnType<typeof entry>[] = []): ResumeDoc => ({
  education: [],
  experience,
  projects,
  skills: [],
  leadership: [],
  meta: { matchedKeywords: [], gaps: [], valuesReflected: [] },
});

describe("placeOptions", () => {
  it("lists every role on the page, even when the model shortened the company name", () => {
    const opts = placeOptions(page([entry("Taskwise"), entry("Northwind")]), master);
    expect(opts.map((o) => o.label)).toEqual(["Taskwise (Founding Engineer)", "Northwind, Search Team (Software Engineer Intern)"]);
    expect(opts[1].role).toEqual({ company: "Northwind, Search Team", title: "Software Engineer Intern" });
  });

  it("skips entries that aren't in her experience and lists each role once", () => {
    expect(placeOptions(page([entry("Google"), entry("Taskwise"), entry("Taskwise")]), master).map((o) => o.role.company)).toEqual(["Taskwise"]);
  });
});

describe("placeTarget", () => {
  it("finds the role on the page by its full or short company name", () => {
    const d = page([entry("Taskwise"), entry("Northwind")]);
    expect(placeTarget(d, "Northwind, Search Team")).toEqual({ section: "experience", entry: 1 });
    expect(placeTarget(d, "Elsewhere")).toBeUndefined();
  });
});
