import { describe, expect, it } from "vitest";
import { parseDocx } from "../docx/parse";
import type { ResumeStructure } from "../docx/types";
import { buildDocxTemplate } from "./buildDocxTemplate";

function structure(): ResumeStructure {
  return {
    format: "pdf",
    headerText: "Alex Rivera\nAustin, TX | alex.rivera@example.com",
    fullText: "",
    sections: [
      {
        heading: "EXPERIENCE",
        kind: "experience",
        context: "Founding Software Engineer, Taskwise, Remote, Oct 2025 - Present",
        bullets: [{ id: "b1", text: "Built and deployed a habit tracking platform serving 80+ early users." }],
        skillGroups: [],
      },
      {
        heading: "TECHNICAL SKILLS",
        kind: "skills",
        context: "",
        bullets: [],
        skillGroups: [{ id: "s1", label: "Frontend", items: ["React", "Next.js"] }],
      },
    ],
  };
}

describe("buildDocxTemplate", () => {
  it("produces a docx that our own parser can read back", async () => {
    const bytes = await buildDocxTemplate(structure());
    const parsed = await parseDocx(bytes);
    expect(parsed.headerText).toContain("Alex Rivera");
    const experience = parsed.sections.find((s) => s.kind === "experience");
    expect(experience?.bullets[0]?.text).toContain("80+ early users");
    const skills = parsed.sections.find((s) => s.kind === "skills");
    expect(skills?.skillGroups[0]).toEqual({ id: expect.any(String), label: "Frontend", items: ["React", "Next.js"] });
  });
});
