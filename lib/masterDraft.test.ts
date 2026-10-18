import { beforeEach, describe, expect, it } from "vitest";
import {
  db,
  getMasterProfile,
  getMasterProfileDoc,
  listMasterVersions,
  MASTER_EDIT_SNAPSHOT_MS,
  MASTER_VERSIONS_KEPT,
  restoreMasterVersion,
  saveMasterProfile,
  saveMasterProfileChecked,
} from "./db";
import { MasterDraftController, type MasterDraftState } from "./masterDraft";

const ALEX = "### Experience\n**Software Engineer Intern | Brightloop | Austin, TX | May 2025 - Aug 2025**\n- Built a dashboard\n\n### Skills\n- Languages: TypeScript";
const WITH_GO = ALEX + ", Go";

beforeEach(async () => {
  await db.docs.clear();
});

describe("master profile versions", () => {
  it("keeps the replaced text as a version on an import or tailoring save", async () => {
    await saveMasterProfile(ALEX);
    await saveMasterProfile(WITH_GO, "import");
    expect(await getMasterProfile()).toBe(WITH_GO);
    const versions = await listMasterVersions();
    expect(versions).toHaveLength(1);
    expect(versions[0]).toMatchObject({ text: ALEX, reason: "import", versionOf: "masterProfile" });
  });

  it("does not keep a version for an unchanged save or an empty text", async () => {
    await saveMasterProfile("");
    await saveMasterProfile(ALEX);
    await saveMasterProfile(ALEX);
    expect(await listMasterVersions()).toHaveLength(0);
  });

  it("keeps at most one version per 10 minutes while typing", async () => {
    const t0 = 1_000_000;
    await saveMasterProfileChecked(ALEX, { now: t0 });
    await saveMasterProfileChecked(ALEX + " a", { reason: "edit", now: t0 + 1000 });
    await saveMasterProfileChecked(ALEX + " ab", { reason: "edit", now: t0 + 2000 });
    expect(await listMasterVersions()).toHaveLength(1);
    await saveMasterProfileChecked(ALEX + " abc", { reason: "edit", now: t0 + 2000 + MASTER_EDIT_SNAPSHOT_MS });
    expect((await listMasterVersions()).map((v) => v.text)).toEqual([ALEX + " ab", ALEX]);
  });

  it("keeps only the newest versions", async () => {
    for (let i = 0; i < MASTER_VERSIONS_KEPT + 4; i++) await saveMasterProfileChecked(`${ALEX} ${i}`, { now: 1000 + i });
    const versions = await listMasterVersions();
    expect(versions).toHaveLength(MASTER_VERSIONS_KEPT);
    expect(versions[0].text).toBe(`${ALEX} ${MASTER_VERSIONS_KEPT + 2}`);
  });

  it("restores a version and keeps what it replaced", async () => {
    await saveMasterProfile(ALEX);
    await saveMasterProfile(WITH_GO);
    const [old] = await listMasterVersions();
    await restoreMasterVersion(old.id);
    expect(await getMasterProfile()).toBe(ALEX);
    expect((await listMasterVersions()).map((v) => v.text)).toContain(WITH_GO);
  });

  it("refuses a checked save when the stored text changed since it was loaded", async () => {
    await saveMasterProfile(ALEX);
    const loaded = (await getMasterProfileDoc())!.updatedAt;
    await saveMasterProfile(WITH_GO, "tailor");
    const res = await saveMasterProfileChecked(ALEX + "\n- typed", { reason: "edit", expectedUpdatedAt: loaded });
    expect(res.ok).toBe(false);
    expect(await getMasterProfile()).toBe(WITH_GO);
  });
});

describe("MasterDraftController", () => {
  const make = () => {
    const states: MasterDraftState[] = [];
    const ctl = new MasterDraftController((s) => states.push(s));
    return { ctl, last: () => states[states.length - 1] };
  };

  it("follows the database while nothing is unsaved", async () => {
    await saveMasterProfile(ALEX);
    const { ctl, last } = make();
    ctl.external(await getMasterProfileDoc());
    expect(last().text).toBe(ALEX);
    await saveMasterProfile(WITH_GO, "tailor");
    ctl.external(await getMasterProfileDoc());
    expect(last().text).toBe(WITH_GO);
  });

  it("saves typing, and does not undo a skill added elsewhere: it stops with a conflict", async () => {
    await saveMasterProfile(ALEX);
    const { ctl, last } = make();
    ctl.external(await getMasterProfileDoc());
    ctl.edit(ALEX + "\n- Led a team");
    // Meanwhile tailoring adds Go (the editor has unsaved typing, so it doesn't follow).
    await saveMasterProfile(WITH_GO, "tailor");
    ctl.external(await getMasterProfileDoc());
    await ctl.flush();
    expect(last().status).toBe("conflict");
    expect(last().theirs).toBe(WITH_GO);
    expect(await getMasterProfile()).toBe(WITH_GO);
  });

  it("'keep my edits' saves them and keeps the other version", async () => {
    await saveMasterProfile(ALEX);
    const { ctl } = make();
    ctl.external(await getMasterProfileDoc());
    ctl.edit(ALEX + "\n- Led a team");
    await saveMasterProfile(WITH_GO, "tailor");
    await ctl.flush();
    await ctl.resolve("mine");
    expect(await getMasterProfile()).toBe(ALEX + "\n- Led a team");
    expect((await listMasterVersions()).map((v) => v.text)).toContain(WITH_GO);
  });

  it("'use the saved version' shows it and keeps her edits as a version", async () => {
    await saveMasterProfile(ALEX);
    const { ctl, last } = make();
    ctl.external(await getMasterProfileDoc());
    ctl.edit(ALEX + "\n- Led a team");
    await saveMasterProfile(WITH_GO, "tailor");
    await ctl.flush();
    await ctl.resolve("theirs");
    expect(last().text).toBe(WITH_GO);
    expect(last().status).toBe("saved");
    expect(await getMasterProfile()).toBe(WITH_GO);
    expect((await listMasterVersions()).map((v) => v.text)).toContain(ALEX + "\n- Led a team");
  });

  it("its own saves never count as a conflict", async () => {
    await saveMasterProfile(ALEX);
    const { ctl, last } = make();
    ctl.external(await getMasterProfileDoc());
    ctl.edit(ALEX + " 1");
    await ctl.flush();
    ctl.external(await getMasterProfileDoc());
    ctl.edit(ALEX + " 12");
    await ctl.flush();
    expect(last().status).toBe("saved");
    expect(await getMasterProfile()).toBe(ALEX + " 12");
  });
});
