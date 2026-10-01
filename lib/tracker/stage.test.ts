import { describe, expect, it } from "vitest";
import { blankApplication } from "./blank";
import { addDays, applyStageChange, completeFollowUp, daysBetween, needsFollowUp, snoozeFollowUp, todayISO } from "./stage";

const TODAY = "2026-09-21";

describe("applyStageChange", () => {
  it("sets the apply date when moving to Applied", () => {
    const out = applyStageChange(blankApplication(), "Applied", TODAY);
    expect(out).toMatchObject({ stage: "Applied", appliedDate: TODAY, respondDate: "" });
  });

  it("sets the respond date (and a missing apply date) for reply stages", () => {
    const out = applyStageChange(blankApplication(), "Rejected", TODAY);
    expect(out).toMatchObject({ stage: "Rejected", respondDate: TODAY, appliedDate: TODAY });
  });

  it("never overwrites dates that are already set", () => {
    const app = { ...blankApplication(), appliedDate: "2026-09-01", respondDate: "2026-09-05" };
    const out = applyStageChange(app, "Waiting for interview", TODAY);
    expect(out.appliedDate).toBe("2026-09-01");
    expect(out.respondDate).toBe("2026-09-05");
  });

  it("leaves dates alone when moving back to Saved", () => {
    const out = applyStageChange(blankApplication(), "Saved", TODAY);
    expect(out.appliedDate).toBe("");
    expect(out.followUpDate).toBe("");
  });

  it("sets a follow-up a week after the apply date when moving to Applied", () => {
    expect(applyStageChange(blankApplication(), "Applied", TODAY).followUpDate).toBe("2026-09-28");
    const earlier = { ...blankApplication(), appliedDate: "2026-09-01" };
    expect(applyStageChange(earlier, "Applied", TODAY).followUpDate).toBe("2026-09-08");
  });

  it("keeps a follow-up date that is already set", () => {
    const app = { ...blankApplication(), followUpDate: "2026-10-15" };
    expect(applyStageChange(app, "Applied", TODAY).followUpDate).toBe("2026-10-15");
  });

  it("only sets a follow-up for Applied, not reply stages", () => {
    expect(applyStageChange(blankApplication(), "Rejected", TODAY).followUpDate).toBe("");
  });
});

describe("daysBetween", () => {
  it("counts whole days and handles missing dates", () => {
    expect(daysBetween("2026-09-01", "2026-09-10")).toBe(9);
    expect(daysBetween("", "2026-09-10")).toBeNull();
    expect(daysBetween("bad", "2026-09-10")).toBeNull();
  });
});

describe("needsFollowUp", () => {
  const applied = { ...blankApplication(), stage: "Applied" as const, appliedDate: "2026-09-01", followUpDate: "2026-09-08" };
  it("is true once the follow-up date has arrived with no reply", () => {
    expect(needsFollowUp(applied, TODAY)).toBe(true);
  });
  it("is false before the date, after a reply, or when not Applied", () => {
    expect(needsFollowUp({ ...applied, followUpDate: "2026-10-01" }, TODAY)).toBe(false);
    expect(needsFollowUp({ ...applied, respondDate: "2026-09-05" }, TODAY)).toBe(false);
    expect(needsFollowUp({ ...applied, stage: "Rejected" }, TODAY)).toBe(false);
  });
});

describe("addDays", () => {
  it("crosses month and year boundaries and rejects bad dates", () => {
    expect(addDays("2026-09-28", 7)).toBe("2026-10-05");
    expect(addDays("2026-12-29", 7)).toBe("2027-01-05");
    expect(addDays("bad", 7)).toBe("");
  });
});

describe("follow-up actions", () => {
  const due = { ...blankApplication(), stage: "Applied" as const, appliedDate: "2026-09-01", followUpDate: "2026-09-08" };
  it("Done clears the reminder", () => {
    const out = completeFollowUp(due);
    expect(out.followUpDate).toBe("");
    expect(needsFollowUp(out, TODAY)).toBe(false);
  });
  it("Snooze moves it a week from today", () => {
    const out = snoozeFollowUp(due, TODAY);
    expect(out.followUpDate).toBe("2026-09-28");
    expect(needsFollowUp(out, TODAY)).toBe(false);
    expect(needsFollowUp(out, "2026-09-28")).toBe(true);
  });
});

describe("todayISO", () => {
  it("formats a local date as YYYY-MM-DD", () => {
    expect(todayISO(new Date(2026, 8, 5))).toBe("2026-09-05");
  });
});
