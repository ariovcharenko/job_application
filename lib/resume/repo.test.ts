import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseDocx } from "../docx/parse";
import { applyAcceptedTailoring, tailoredFileName } from "./repo";
import type { TailorResult } from "./tailor";

function loadFixture(): ArrayBuffer {
  const buf = readFileSync(join(__dirname, "../docx/__fixtures__/sample-resume.docx"));
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}

describe("tailoredFileName", () => {
  it("slugifies name and company into the established naming convention", () => {
    expect(tailoredFileName("Alex Rivera", "Stripe")).toBe("Alex_Rivera_Resume_Stripe.docx");
  });

  it("handles a company with spaces and punctuation", () => {
    expect(tailoredFileName("Alex Rivera", "Motorola, Inc.")).toBe("Alex_Rivera_Resume_Motorola_Inc.docx");
  });

  it("falls back sensibly when company is blank", () => {
    expect(tailoredFileName("Alex Rivera", "")).toBe("Alex_Rivera_Resume.docx");
  });

  it("adds a slug of the role so two roles at one company get different files", () => {
    expect(tailoredFileName("Alex Rivera", "Google", "Software Engineer")).toBe("Alex_Rivera_Resume_Google_Software_Engineer.docx");
    expect(tailoredFileName("Alex Rivera", "Google", "Product Manager, AI")).toBe("Alex_Rivera_Resume_Google_Product_Manager_AI.docx");
  });

  it("ignores a blank role and keeps the old name", () => {
    expect(tailoredFileName("Alex Rivera", "Stripe", "  ")).toBe("Alex_Rivera_Resume_Stripe.docx");
  });

  it("trims a long role at a word boundary", () => {
    const name = tailoredFileName("Alex Rivera", "Google", "Software Engineer, Machine Learning Infrastructure (New Grad 2026)");
    const role = name.replace("Alex_Rivera_Resume_Google_", "").replace(".docx", "");
    expect(role.length).toBeLessThanOrEqual(40);
    expect(role).toBe("Software_Engineer_Machine_Learning");
  });

  it("uses the role even without a company", () => {
    expect(tailoredFileName("Alex Rivera", "", "Data Analyst")).toBe("Alex_Rivera_Resume_Data_Analyst.docx");
  });
});

describe("applyAcceptedTailoring (docx)", () => {
  it("only writes accepted bullet edits, applies skill reorders, and appends applied suggestions", async () => {
    const bytes = loadFixture();
    const structure = await parseDocx(bytes);
    const experience = structure.sections.find((s) => s.kind === "experience")!;
    const [b1, b2] = experience.bullets;
    const skills = structure.sections.find((s) => s.kind === "skills")!;
    const frontend = skills.skillGroups.find((g) => g.label === "Frontend")!;

    const result: TailorResult = {
      bulletEdits: [
        { id: b1.id, newText: "Accepted rewrite of the first bullet." },
        { id: b2.id, newText: "Rejected rewrite of the second bullet." },
      ],
      skillReorders: [{ id: frontend.id, items: [...frontend.items].reverse() }],
      suggestedSkills: [],
    };

    const edited = await applyAcceptedTailoring(
      { label: "SWE", fileName: "x.docx", format: "docx", bytes, addedAt: 0 },
      structure,
      result,
      { acceptedBulletIds: new Set([b1.id]), appliedSkills: [{ skill: "Kubernetes", evidence: "..." }] },
    );

    const after = await parseDocx(edited);
    const afterExperience = after.sections.find((s) => s.kind === "experience")!;
    expect(afterExperience.bullets.find((b) => b.id === b1.id)?.text).toBe("Accepted rewrite of the first bullet.");
    expect(afterExperience.bullets.find((b) => b.id === b2.id)?.text).toBe(b2.text); // rejected, unchanged

    const afterSkills = after.sections.find((s) => s.kind === "skills")!;
    expect(afterSkills.skillGroups.find((g) => g.id === frontend.id)?.items).toEqual([...frontend.items].reverse());
    const added = afterSkills.skillGroups.at(-1)!;
    expect(added.label).toBe("Additional");
    expect(added.items).toEqual(["Kubernetes"]);
  });
});
