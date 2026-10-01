import { exportBackup } from "./backup";
import { getSettings } from "./db";
import { hasPermission } from "./fsAccess";

// Automatic backups to a folder on her computer, so nothing is lost if the browser's site data is
// cleared or an update ever went wrong. Everything in the app (jobs, tailored resumes, profile,
// experience, answers, contacts) is written as the same file "Backup and restore" makes, without
// API keys. One "latest" file plus one per day, keeping the last KEEP_DAYS days.

export const LATEST_FILE = "job-copilot-backup-latest.json";
export const KEEP_DAYS = 14;
const DATED = /^job-copilot-backup-(\d{4}-\d{2}-\d{2})\.json$/;
const LAST_KEY = "job-copilot:last-auto-backup";

/** "job-copilot-backup-2026-09-30.json", by local calendar day. */
export function datedFileName(now: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `job-copilot-backup-${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}.json`;
}

/** Dated backup files beyond the newest `keep`, oldest first. Other files are never touched. */
export function filesToPrune(names: string[], keep = KEEP_DAYS): string[] {
  const dated = names.filter((n) => DATED.test(n)).sort();
  return dated.slice(0, Math.max(0, dated.length - keep));
}

async function writeText(dir: FileSystemDirectoryHandle, name: string, text: string): Promise<void> {
  const file = await dir.getFileHandle(name, { create: true });
  const w = await file.createWritable();
  await w.write(text);
  await w.close();
}

export async function writeAutoBackup(dir: FileSystemDirectoryHandle, text: string, now = new Date()): Promise<void> {
  await writeText(dir, LATEST_FILE, text);
  await writeText(dir, datedFileName(now), text);
  const names: string[] = [];
  for await (const [name] of (dir as unknown as { entries(): AsyncIterable<[string, FileSystemHandle]> }).entries()) names.push(name);
  for (const name of filesToPrune(names)) await dir.removeEntry(name);
}

/** Fired on window after each automatic backup attempt, with the AutoBackupStatus as detail. */
export const AUTO_BACKUP_EVENT = "job-copilot:auto-backup";

export type AutoBackupStatus = { kind: "off" } | { kind: "needs-permission"; folder: string } | { kind: "saved"; folder: string; at: number } | { kind: "error"; message: string };

export function lastAutoBackupAt(): number | null {
  try {
    const v = Number(localStorage.getItem(LAST_KEY));
    return Number.isFinite(v) && v > 0 ? v : null;
  } catch {
    return null;
  }
}

/**
 * Writes a backup now if she has picked a backup folder and the browser still allows writing to it
 * (checked without prompting, so this is safe to run on its own; re-allowing needs her click).
 */
export async function runAutoBackup(now = new Date()): Promise<AutoBackupStatus> {
  const settings = await getSettings();
  const dir = settings.backupFolder;
  if (!dir) return { kind: "off" };
  if (!(await hasPermission(dir, "readwrite"))) return { kind: "needs-permission", folder: dir.name };
  try {
    await writeAutoBackup(dir, await exportBackup({ includeKey: false, now }), now);
    try {
      localStorage.setItem(LAST_KEY, String(now.getTime()));
    } catch {
      // A private window may block storage; the backup itself was written.
    }
    return { kind: "saved", folder: dir.name, at: now.getTime() };
  } catch (e) {
    return { kind: "error", message: e instanceof Error ? e.message : String(e) };
  }
}
