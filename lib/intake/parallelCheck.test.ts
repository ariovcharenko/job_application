import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AIError } from "../ai/provider";
import type { EarlyRead } from "./earlyRead";
import { startParallelCheck } from "./parallelCheck";

const READ: EarlyRead = { noSponsor: 0.99, noOpt: 0, citizenOrClearance: 0, workStyle: null, interviewFocus: null };
const OFFER = { reason: "won't sponsor" };

/** A fake Claude check that takes `ms` and rejects with "cancelled" when aborted. */
function fakeCheck(ms: number) {
  const started = vi.fn();
  const check = (signal: AbortSignal) =>
    new Promise<string>((resolve, reject) => {
      started();
      const timer = setTimeout(() => resolve("verdict"), ms);
      signal.addEventListener("abort", () => {
        clearTimeout(timer);
        reject(new AIError("cancelled", "stopped"));
      });
    });
  return { check, started };
}

const jevAfter = (ms: number, read: EarlyRead | null = READ) => new Promise<EarlyRead | null>((r) => setTimeout(() => r(read), ms));

describe("startParallelCheck", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("starts Claude immediately, without waiting for Jev", () => {
    const { check, started } = fakeCheck(3000);
    startParallelCheck({ check, early: jevAfter(4000), offerFor: () => null, onOffer: vi.fn() });
    expect(started).toHaveBeenCalledTimes(1); // before any timer has advanced
  });

  it("Jev first: shows the offer while Claude runs; Skip aborts Claude", async () => {
    const { check } = fakeCheck(3000);
    const onOffer = vi.fn();
    const run = startParallelCheck({ check, early: jevAfter(1000), offerFor: () => OFFER, onOffer });
    const outcome = run.result.then(
      (v) => v,
      (e) => e,
    );
    await vi.advanceTimersByTimeAsync(1000);
    expect(onOffer).toHaveBeenCalledTimes(1);
    expect(run.settled()).toBe(false);
    run.abort(); // she clicks Skip
    const e = await outcome;
    expect(e).toBeInstanceOf(AIError);
    expect((e as AIError).kind).toBe("cancelled");
  });

  it("Jev first: Check anyway (no abort) lets Claude finish", async () => {
    const { check } = fakeCheck(3000);
    const run = startParallelCheck({ check, early: jevAfter(1000), offerFor: () => OFFER, onOffer: vi.fn() });
    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(2000);
    await expect(run.result).resolves.toBe("verdict");
  });

  it("Claude first: no offer at all", async () => {
    const { check } = fakeCheck(500);
    const onOffer = vi.fn();
    const run = startParallelCheck({ check, early: jevAfter(2000), offerFor: () => OFFER, onOffer });
    await vi.advanceTimersByTimeAsync(500);
    await expect(run.result).resolves.toBe("verdict");
    expect(run.settled()).toBe(true);
    await vi.advanceTimersByTimeAsync(2000);
    expect(onOffer).not.toHaveBeenCalled();
  });

  it("no offer when Jev has nothing (null) or offerFor says no", async () => {
    const a = fakeCheck(3000);
    const onOffer = vi.fn();
    startParallelCheck({ check: a.check, early: jevAfter(100, null), offerFor: () => OFFER, onOffer });
    startParallelCheck({ check: fakeCheck(3000).check, early: jevAfter(100), offerFor: () => null, onOffer });
    await vi.advanceTimersByTimeAsync(200);
    expect(onOffer).not.toHaveBeenCalled();
  });

  it("a Claude failure does not leave an unhandled rejection", async () => {
    const run = startParallelCheck({ check: () => Promise.reject(new AIError("auth", "bad key")), early: Promise.resolve(null), offerFor: () => null, onOffer: vi.fn() });
    await expect(run.result).rejects.toMatchObject({ kind: "auth" });
  });
});
