import type { EarlyRead, SkipOffer } from "./earlyRead";

// Runs Claude's check and the optional Jev early read side by side. Claude never waits for Jev.
// If Jev's skip offer arrives while Claude is still running, onOffer fires; abort() then stops
// Claude's call (she chose Skip). If Claude finishes first, there is no offer at all.

export interface ParallelCheck<T> {
  /** Claude's check. Rejects with AIError "cancelled" after abort(). */
  result: Promise<T>;
  /** Stops Claude's call (AbortSignal). Safe to call after it finished. */
  abort(): void;
  /** Whether Claude's check has settled (so a late offer is moot). */
  settled(): boolean;
}

export function startParallelCheck<T>(o: {
  check: (signal: AbortSignal) => Promise<T>;
  early: Promise<EarlyRead | null>;
  offerFor: (read: EarlyRead) => SkipOffer | null;
  onOffer: (offer: SkipOffer, read: EarlyRead) => void;
}): ParallelCheck<T> {
  const ctl = new AbortController();
  let done = false;
  const result = o.check(ctl.signal).finally(() => {
    done = true;
  });
  // Claude's rejection is handled by the caller; this branch must not add an unhandled one.
  result.catch(() => {});
  void o.early.then((read) => {
    if (!read || done || ctl.signal.aborted) return;
    const offer = o.offerFor(read);
    if (offer) o.onOffer(offer, read);
  });
  return { result, abort: () => ctl.abort(), settled: () => done };
}
