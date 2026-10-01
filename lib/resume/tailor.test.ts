import { describe, expect, it } from "vitest";
import type { ResumeStructure } from "../docx/types";
import { validateTailorResult } from "./tailor";

function structure(): ResumeStructure {
  return {
    format: "docx",
    headerText: "Alex Rivera",
    fullText: "",
    sections: [
      {
        heading: "EXPERIENCE",
        kind: "experience",
        context: "Founding Software Engineer, Taskwise",
        bullets: [
          { id: "b1", text: "Built a task platform serving 80+ users." },
          { id: "b2", text: "Deployed on Render." },
        ],
        skillGroups: [],
      },
      {
        heading: "TECHNICAL SKILLS",
        kind: "skills",
        context: "",
        bullets: [],
        skillGroups: [{ id: "s1", label: "Frontend", items: ["React", "Next.js", "Tailwind CSS"] }],
      },
    ],
  };
}

describe("validateTailorResult", () => {
  it("keeps a bullet edit for a real bullet id", () => {
    const result = validateTailorResult(structure(), {
      bulletEdits: [{ id: "b1", newText: "Shipped a task platform serving 80+ users." }],
      skillReorders: [],
      suggestedSkills: [],
    });
    expect(result.bulletEdits).toEqual([{ id: "b1", newText: "Shipped a task platform serving 80+ users." }]);
  });

  it("drops an edit for an id that doesn't exist on the resume", () => {
    const result = validateTailorResult(structure(), {
      bulletEdits: [{ id: "made-up-id", newText: "Fabricated employer and metrics." }],
      skillReorders: [],
      suggestedSkills: [],
    });
    expect(result.bulletEdits).toEqual([]);
  });

  it("drops an empty-text edit", () => {
    const result = validateTailorResult(structure(), {
      bulletEdits: [{ id: "b1", newText: "   " }],
      skillReorders: [],
      suggestedSkills: [],
    });
    expect(result.bulletEdits).toEqual([]);
  });

  it("accepts a skill reorder that's the same items in a new order", () => {
    const result = validateTailorResult(structure(), {
      bulletEdits: [],
      skillReorders: [{ id: "s1", items: ["Next.js", "React", "Tailwind CSS"] }],
      suggestedSkills: [],
    });
    expect(result.skillReorders).toEqual([{ id: "s1", items: ["Next.js", "React", "Tailwind CSS"] }]);
  });

  it("rejects a skill reorder that adds an item not in the original group", () => {
    const result = validateTailorResult(structure(), {
      bulletEdits: [],
      skillReorders: [{ id: "s1", items: ["React", "Next.js", "Tailwind CSS", "Vue"] }],
      suggestedSkills: [],
    });
    expect(result.skillReorders).toEqual([]);
  });

  it("rejects a skill reorder that drops an item from the original group", () => {
    const result = validateTailorResult(structure(), {
      bulletEdits: [],
      skillReorders: [{ id: "s1", items: ["React", "Next.js"] }],
      suggestedSkills: [],
    });
    expect(result.skillReorders).toEqual([]);
  });

  it("filters out a suggested skill that's already on the resume", () => {
    const result = validateTailorResult(structure(), {
      bulletEdits: [],
      skillReorders: [],
      suggestedSkills: [
        { skill: "react", evidence: "React experience required" },
        { skill: "Kubernetes", evidence: "Experience with Kubernetes" },
      ],
    });
    expect(result.suggestedSkills).toEqual([{ skill: "Kubernetes", evidence: "Experience with Kubernetes" }]);
  });

  it("caps suggested skills at 8", () => {
    const suggestedSkills = Array.from({ length: 12 }, (_, i) => ({ skill: `Skill${i}`, evidence: `evidence ${i}` }));
    const result = validateTailorResult(structure(), { bulletEdits: [], skillReorders: [], suggestedSkills });
    expect(result.suggestedSkills.length).toBe(8);
  });
});
