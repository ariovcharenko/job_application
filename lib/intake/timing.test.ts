import { describe, expect, it } from "vitest";
import { checkedInLabel, createCheckTimer, formatSeconds, timingBreakdown } from "./timing";

describe("check timer", () => {
  it("measures each step and the total from a fake clock", () => {
    let t = 1000;
    const timer = createCheckTimer(() => t);
    timer.start("read");
    t += 400;
    timer.end("read");
    timer.start("jev");
    timer.start("claude");
    t += 1100;
    timer.end("jev");
    t += 2700;
    timer.end("claude");
    timer.start("save");
    t += 100;
    timer.end("save");
    const snap = timer.snapshot();
    expect(snap.steps).toEqual({ read: 400, jev: 1100, claude: 3800, save: 100 });
    expect(snap.totalMs).toBe(4300);
    expect(checkedInLabel(snap)).toBe("Checked in 4.3s");
    expect(timingBreakdown(snap)).toBe("Read 0.4s, Early read 1.1s, Claude 3.8s, Save 0.1s");
  });

  it("ignores an end with no start, a second end, and omits steps that never ran", () => {
    let t = 0;
    const timer = createCheckTimer(() => t);
    timer.end("jev");
    timer.start("claude");
    t += 500;
    timer.end("claude");
    t += 900;
    timer.end("claude");
    expect(timer.snapshot().steps).toEqual({ claude: 500 });
  });

  it("formats tiny durations as at least 0.1s", () => {
    expect(formatSeconds(3)).toBe("0.1s");
    expect(formatSeconds(4249)).toBe("4.2s");
  });
});
