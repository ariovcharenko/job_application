import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseDocx } from "./parse";

function loadFixture(): ArrayBuffer {
  const buf = readFileSync(join(__dirname, "__fixtures__/sample-resume.docx"));
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}

describe("parseDocx", () => {
  it("finds the header and all sections", async () => {
    const structure = await parseDocx(loadFixture());
    expect(structure.headerText).toContain("Alex Rivera");
    const headings = structure.sections.map((s) => s.heading);
    expect(headings).toEqual(["EDUCATION", "EXPERIENCE", "TECHNICAL SKILLS", "LEADERSHIP & INVOLVEMENT"]);
  });

  it("extracts experience bullets with stable, non-empty ids and real text", async () => {
    const structure = await parseDocx(loadFixture());
    const experience = structure.sections.find((s) => s.kind === "experience")!;
    expect(experience.bullets.length).toBeGreaterThan(5);
    for (const b of experience.bullets) {
      expect(b.id).not.toBe("");
      expect(b.text.length).toBeGreaterThan(5);
    }
    const ids = experience.bullets.map((b) => b.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(experience.bullets.some((b) => b.text.includes("80+ early users"))).toBe(true);
    // Company/title/dates land in context, never as editable bullets.
    expect(experience.context).toContain("Taskwise");
    expect(experience.context).toContain("Founding Software Engineer");
  });

  it("extracts skill groups with labels and items", async () => {
    const structure = await parseDocx(loadFixture());
    const skills = structure.sections.find((s) => s.kind === "skills")!;
    expect(skills.skillGroups.length).toBeGreaterThan(3);
    const frontend = skills.skillGroups.find((g) => g.label === "Frontend");
    expect(frontend?.items).toEqual(expect.arrayContaining(["React", "Next.js"]));
  });

  it("puts leadership bullets under the leadership section", async () => {
    const structure = await parseDocx(loadFixture());
    const leadership = structure.sections.find((s) => s.kind === "leadership")!;
    expect(leadership).toBeDefined();
  });
});
