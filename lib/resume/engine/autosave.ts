// The tailoring panel saves each new version of the resume to its job shortly after it settles.
// Plain timer logic, kept out of the component so it can be tested: only the latest version is
// saved, saves run one at a time (a slow older save can't land after a newer one), and a pending
// save can be flushed when the panel closes instead of being dropped.

export interface DebouncedSave {
  /** Replaces any pending save with this one, run after the delay. */
  schedule(task: () => Promise<void>): void;
  /** Runs the pending save now (if any); resolves when every save so far has finished. */
  flush(): Promise<void>;
  /** Drops the pending save. */
  cancel(): void;
}

export function createDebouncedSave(delayMs: number): DebouncedSave {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending: (() => Promise<void>) | null = null;
  let chain: Promise<void> = Promise.resolve();

  const run = (): Promise<void> => {
    if (timer) clearTimeout(timer);
    timer = null;
    const task = pending;
    pending = null;
    if (task) chain = chain.then(task).catch(() => undefined); // the task reports its own errors
    return chain;
  };

  return {
    schedule(task) {
      if (timer) clearTimeout(timer);
      pending = task;
      timer = setTimeout(() => void run(), delayMs);
    },
    flush: run,
    cancel() {
      if (timer) clearTimeout(timer);
      timer = null;
      pending = null;
    },
  };
}
