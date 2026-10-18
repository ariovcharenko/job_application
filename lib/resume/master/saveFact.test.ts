import { beforeEach, describe, expect, it } from "vitest";
import { db, getMasterProfile, listMasterVersions, saveMasterProfile } from "../../db";
import { MASTER } from "../engine/__fixtures__/master";
import { parseRoleFacts } from "./facts";
import { saveRoleFact } from "./saveFact";

beforeEach(async () => {
  await db.docs.clear();
});

describe("saveRoleFact", () => {
  it("appends the fact to the stored text and keeps the text it replaced as a version", async () => {
    await saveMasterProfile(MASTER, "import");
    const next = await saveRoleFact({ company: "Brightloop", title: "Software Engineer Intern" }, "about 900 daily users");
    expect(await getMasterProfile()).toBe(next);
    expect(parseRoleFacts(next)).toEqual([{ role: { company: "Brightloop", title: "Software Engineer Intern" }, text: "about 900 daily users" }]);
    const versions = await listMasterVersions();
    expect(versions[0]).toMatchObject({ text: MASTER, reason: "tailor" });
  });

  it("builds on what is stored now, so an edit made elsewhere isn't written over", async () => {
    await saveMasterProfile(MASTER, "import");
    await saveMasterProfile(`${MASTER}\n- edited in another tab`, "edit");
    const next = await saveRoleFact({ company: "Taskwise", title: "" }, "3 coaches used it");
    expect(next).toContain("- edited in another tab");
    expect(next).toContain("- Taskwise: 3 coaches used it");
  });

  it("writes nothing when the same fact is already saved", async () => {
    await saveMasterProfile(MASTER, "import");
    await saveRoleFact({ company: "Brightloop", title: "" }, "a fact");
    const before = (await listMasterVersions()).length;
    await saveRoleFact({ company: "Brightloop", title: "" }, "a fact");
    expect((await listMasterVersions()).length).toBe(before);
  });
});
