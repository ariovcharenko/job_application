import { lastAutoBackupAt } from "./autoBackup";

// "When did she last back up?" Automatic backups already note their time in this browser's
// localStorage (lib/autoBackup.ts); downloaded backups note theirs here the same way. Per browser on
// purpose: the data being backed up lives in this browser too. Nothing is added to IndexedDB.

const MANUAL_KEY = "job-copilot:last-manual-backup";

/** Days without a backup before the tracker mentions it. */
export const BACKUP_NUDGE_AFTER_DAYS = 7;

const DAY = 24 * 60 * 60 * 1000;

export function recordManualBackup(now = Date.now()): void {
  try {
    localStorage.setItem(MANUAL_KEY, String(now));
  } catch {
    // Private windows can block storage; the download itself still happened.
  }
}

function lastManualBackupAt(): number | null {
  try {
    const v = Number(localStorage.getItem(MANUAL_KEY));
    return Number.isFinite(v) && v > 0 ? v : null;
  } catch {
    return null;
  }
}

/** The latest backup of either kind, or null if this browser has never made one. */
export function lastBackupAt(): number | null {
  const times = [lastAutoBackupAt(), lastManualBackupAt()].filter((t): t is number => t !== null);
  return times.length ? Math.max(...times) : null;
}

/**
 * The quiet reminder line, or null when none is needed: nothing saved yet, or a backup in the last
 * week. Whole days, counted from the backup's time.
 */
export function backupNudge(lastAt: number | null, now: number, jobCount: number): string | null {
  if (jobCount === 0) return null;
  if (lastAt === null) return "No backup yet";
  const days = Math.floor((now - lastAt) / DAY);
  if (days < BACKUP_NUDGE_AFTER_DAYS) return null;
  return `Last backup ${days} days ago`;
}
