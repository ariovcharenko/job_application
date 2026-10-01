import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { applyDocxEdits } from "./apply";
import { parseDocx } from "./parse";

function loadFixture(): ArrayBuffer {
  const buf = readFileSync(join(__dirname, "__fixtures__/sample-resume.docx"));
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}

describe("applyDocxEdits", () => {
  it("rewrites a bullet's text and nothing else", async () => {
    const original = loadFixture();
    const before = await parseDocx(original);
    const experience = before.sections.find((s) => s.kind === "experience")!;
    const target = experience.bullets[0];

    const edited = await applyDocxEdits(original, {
      bullets: { [target.id]: "Rewrote this bullet with a new opening clause and kept the rest." },
      skillGroups: {},
    });

    const after = await parseDocx(edited);
    const afterExperience = after.sections.find((s) => s.kind === "experience")!;
    const afterTarget = afterExperience.bullets.find((b) => b.id === target.id)!;
    expect(afterTarget.text).toContain("Rewrote this bullet with a new opening clause");

    // Every other bullet, and all header/context text, is untouched.
    const otherBefore = experience.bullets.filter((b) => b.id !== target.id);
    const otherAfter = afterExperience.bullets.filter((b) => b.id !== target.id);
    expect(otherAfter.map((b) => b.text)).toEqual(otherBefore.map((b) => b.text));
    expect(after.headerText).toBe(before.headerText);
    expect(after.sections.map((s) => s.heading)).toEqual(before.sections.map((s) => s.heading));
    expect(afterExperience.context).toBe(experience.context);
  });

  it("keeps a substring bold if it was bold before and still appears in the new text", async () => {
    const original = loadFixture();
    const before = await parseDocx(original);
    const experience = before.sections.find((s) => s.kind === "experience")!;
    const target = experience.bullets.find((b) => b.text.includes("80+ early users"))!;
    expect(target).toBeDefined();

    const newText = target.text.replace("Built and deployed", "Designed, built, and deployed");
    const edited = await applyDocxEdits(original, { bullets: { [target.id]: newText }, skillGroups: {} });

    // Round-trip through JSZip/XML directly to inspect run-level bold markup.
    const JSZip = (await import("jszip")).default;
    const zip = await JSZip.loadAsync(edited);
    const xml = await zip.file("word/document.xml")!.async("string");
    expect(xml).toContain("<w:b/>");
    // Some bold run in the document is exactly the preserved metric phrase.
    const boldRunTexts = [...xml.matchAll(/<w:r>\s*<w:rPr>\s*<w:b\/>\s*<\/w:rPr>\s*<w:t[^>]*>([^<]*)<\/w:t>\s*<\/w:r>/g)].map((m) => m[1]);
    expect(boldRunTexts).toContain("80+ early users");
  });

  it("reorders skill items while keeping the bold category label", async () => {
    const original = loadFixture();
    const before = await parseDocx(original);
    const skills = before.sections.find((s) => s.kind === "skills")!;
    const frontend = skills.skillGroups.find((g) => g.label === "Frontend")!;
    const reordered = [...frontend.items].reverse();

    const edited = await applyDocxEdits(original, { bullets: {}, skillGroups: { [frontend.id]: reordered } });
    const after = await parseDocx(edited);
    const afterFrontend = after.sections.find((s) => s.kind === "skills")!.skillGroups.find((g) => g.id === frontend.id)!;
    expect(afterFrontend.label).toBe("Frontend");
    expect(afterFrontend.items).toEqual(reordered);
  });

  it("appends a new skill line without disturbing existing ones", async () => {
    const original = loadFixture();
    const before = await parseDocx(original);
    const skillsBefore = before.sections.find((s) => s.kind === "skills")!;

    const edited = await applyDocxEdits(original, {
      bullets: {},
      skillGroups: {},
      newSkillGroups: [{ label: "Additional", items: ["Kubernetes", "Terraform"] }],
    });

    const after = await parseDocx(edited);
    const skillsAfter = after.sections.find((s) => s.kind === "skills")!;
    expect(skillsAfter.skillGroups.length).toBe(skillsBefore.skillGroups.length + 1);
    expect(skillsAfter.skillGroups.map((g) => g.label)).toEqual([...skillsBefore.skillGroups.map((g) => g.label), "Additional"]);
    const added = skillsAfter.skillGroups.at(-1)!;
    expect(added.items).toEqual(["Kubernetes", "Terraform"]);
    // Existing groups are byte-for-byte unaffected.
    expect(skillsAfter.skillGroups.slice(0, -1)).toEqual(skillsBefore.skillGroups);
  });

  it("leaves every other zip entry (styles, numbering, fonts) untouched", async () => {
    const original = loadFixture();
    const JSZip = (await import("jszip")).default;
    const before = await JSZip.loadAsync(original);
    const beforeStyles = await before.file("word/styles.xml")!.async("string");
    const beforeNumbering = await before.file("word/numbering.xml")!.async("string");

    const edited = await applyDocxEdits(original, { bullets: {}, skillGroups: {} });
    const after = await JSZip.loadAsync(edited);
    const afterStyles = await after.file("word/styles.xml")!.async("string");
    const afterNumbering = await after.file("word/numbering.xml")!.async("string");

    expect(afterStyles).toBe(beforeStyles);
    expect(afterNumbering).toBe(beforeNumbering);
  });
});
