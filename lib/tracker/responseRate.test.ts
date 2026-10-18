import { describe, expect, it } from "vitest";
import { STAGES, type Stage } from "../types";
import { blankApplication } from "./blank";
import { responseRateTitle, responseStats } from "./responseRate";

const job = (stage: Stage, respondDate = "") => ({ ...blankApplication(1), company: "Brightloop", stage, respondDate });

describe("responseStats", () => {
  it("counts interviews, offers and rejections as heard back, by stage", () => {
    const s = responseStats([job("Applied"), job("Waiting for interview"), job("Offer"), job("Rejected"), job("No response"), job("Saved")]);
    expect(s).toEqual({ applied: 5, heardBack: 3, rate: 60 });
  });

  it("ignores reply dates: an old auto-stamped date on Applied or No response doesn't count", () => {
    const s = responseStats([job("Applied", "2026-09-01"), job("No response", "2026-09-02"), job("Rejected", "")]);
    expect(s).toEqual({ applied: 3, heardBack: 1, rate: 33 });
  });

  it("leaves Saved and Withdrawn out of the applied pool", () => {
    expect(responseStats([job("Saved"), job("Withdrawn"), job("Rejected")])).toEqual({ applied: 1, heardBack: 1, rate: 100 });
  });

  it("is 0 with nothing applied, and covers every stage", () => {
    expect(responseStats([])).toEqual({ applied: 0, heardBack: 0, rate: 0 });
    expect(responseStats(STAGES.map((s) => job(s))).applied).toBe(STAGES.length - 2);
  });

  it("explains itself in the tooltip", () => {
    expect(responseRateTitle({ applied: 5, heardBack: 3, rate: 60 })).toBe("3 of 5 applied heard back: interview, offer or rejection");
  });
});
