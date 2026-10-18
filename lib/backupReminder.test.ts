import { beforeEach, describe, expect, it } from "vitest";
import { backupNudge, lastBackupAt, recordManualBackup } from "./backupReminder";

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 9, 20, 12);

describe("backupNudge", () => {
  it("says nothing before anything is saved", () => {
    expect(backupNudge(null, NOW, 0)).toBeNull();
  });

  it("mentions a missing backup once there are jobs", () => {
    expect(backupNudge(null, NOW, 3)).toBe("No backup yet");
  });

  it("stays quiet for a week after a backup", () => {
    expect(backupNudge(NOW - 6 * DAY - 1000, NOW, 3)).toBeNull();
    expect(backupNudge(NOW - 7 * DAY, NOW, 3)).toBe("Last backup 7 days ago");
    expect(backupNudge(NOW - 12.5 * DAY, NOW, 3)).toBe("Last backup 12 days ago");
  });
});

describe("lastBackupAt", () => {
  const store = new Map<string, string>();
  beforeEach(() => {
    store.clear();
    globalThis.localStorage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
      clear: () => store.clear(),
      key: () => null,
      length: 0,
    } as Storage;
  });

  it("is null when this browser never backed up", () => {
    expect(lastBackupAt()).toBeNull();
  });

  it("takes the later of a download and an automatic backup", () => {
    recordManualBackup(NOW - 3 * DAY);
    expect(lastBackupAt()).toBe(NOW - 3 * DAY);
    store.set("job-copilot:last-auto-backup", String(NOW - DAY));
    expect(lastBackupAt()).toBe(NOW - DAY);
  });
});
