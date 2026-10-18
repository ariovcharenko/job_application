import { describe, expect, it } from "vitest";
import { MASTER } from "../engine/__fixtures__/master";
import { parseMasterExperiences } from "./experiences";
import { appendRoleFact, FACTS_HEADING, parseRoleFacts } from "./facts";
import { parseSkillInventory, parseUsageNotes } from "./skills";

const brightloop = { company: "Brightloop", title: "Software Engineer Intern" };

describe("appendRoleFact / parseRoleFacts", () => {
  it("adds the heading once and one line per fact, tied to the role", () => {
    const once = appendRoleFact(MASTER, brightloop, "  - about 900 daily   users ");
    expect(once).toContain(`### ${FACTS_HEADING}\n- Brightloop | Software Engineer Intern: about 900 daily users`);
    const twice = appendRoleFact(once, { company: "Taskwise", title: "" }, "used by 3 coaches");
    expect(twice.match(new RegExp(FACTS_HEADING, "g"))).toHaveLength(1);
    expect(parseRoleFacts(twice)).toEqual([
      { role: brightloop, text: "about 900 daily users" },
      { role: { company: "Taskwise", title: "" }, text: "used by 3 coaches" },
    ]);
  });

  it("doesn't add the same fact twice, and ignores empty input", () => {
    const once = appendRoleFact(MASTER, brightloop, "about 900 daily users");
    expect(appendRoleFact(once, { company: "brightloop", title: "software engineer intern" }, "About 900 daily users")).toBe(once);
    expect(appendRoleFact(MASTER, brightloop, "   ")).toBe(MASTER);
    expect(appendRoleFact(MASTER, { company: " ", title: "x" }, "fact")).toBe(MASTER);
  });

  it("keeps facts out of roles, skills and usage notes", () => {
    const withFact = appendRoleFact(MASTER, brightloop, "about 900 daily users");
    expect(parseMasterExperiences(withFact).map((e) => e.block)).toEqual(parseMasterExperiences(MASTER).map((e) => e.block));
    expect(parseSkillInventory(withFact)).toEqual(parseSkillInventory(MASTER));
    expect(parseUsageNotes(withFact)).toEqual([]);
  });

  it("inserts a new fact at the end of an existing heading, before the next section", () => {
    const m = `${MASTER}\n### ${FACTS_HEADING}\n- Brightloop: one\n\n### Usage notes\n- Kotlin: Android screens\n`;
    const next = appendRoleFact(m, brightloop, "two");
    expect(next).toContain("- Brightloop: one\n- Brightloop | Software Engineer Intern: two\n\n### Usage notes");
    expect(parseRoleFacts(next).map((f) => f.text)).toEqual(["one", "two"]);
  });
});
