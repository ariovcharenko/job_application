// Can this browser open IndexedDB? Private windows (older Safari, some Firefox settings) and
// "block all site data" settings make every save fail, so the app warns up front instead.

export const STORAGE_PROBE_DB = "job-copilot-storage-probe";

/**
 * Resolves true when a throwaway database opens, false when IndexedDB is missing or refuses to
 * open. A browser that neither succeeds nor fails within `timeoutMs` is given the benefit of the
 * doubt (true): a false alarm would tell a working browser it can't save.
 */
export function canUseIndexedDB(factory: IDBFactory | undefined, timeoutMs = 4000): Promise<boolean> {
  if (!factory) return Promise.resolve(false);
  return new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => done(true), timeoutMs);
    function done(ok: boolean) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(ok);
    }
    let req: IDBOpenDBRequest;
    try {
      req = factory.open(STORAGE_PROBE_DB);
    } catch {
      done(false);
      return;
    }
    req.onsuccess = () => {
      try {
        req.result.close();
        factory.deleteDatabase(STORAGE_PROBE_DB);
      } catch {
        // Cleanup is best effort; the open itself worked.
      }
      done(true);
    };
    req.onerror = () => done(false);
  });
}
