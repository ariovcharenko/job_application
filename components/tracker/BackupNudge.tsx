"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { AUTO_BACKUP_EVENT } from "@/lib/autoBackup";
import { exportBackup } from "@/lib/backup";
import { backupNudge, lastBackupAt, recordManualBackup } from "@/lib/backupReminder";
import { downloadBlob } from "@/lib/download";
import { fsAccessSupported } from "@/lib/fsAccess";
import { todayISO } from "@/lib/tracker/stage";
import { textButtonClass } from "@/components/ui";

/**
 * "Last backup 12 days ago", one quiet line under the stats, only once there's something to lose
 * and no backup in a week. One click downloads a backup (works in every browser, including Safari
 * and Firefox, which can't do automatic folder backups). The API key is never in it.
 */
export default function BackupNudge({ jobCount }: { jobCount: number }) {
  const [last, setLast] = useState<number | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [folders, setFolders] = useState(false);

  useEffect(() => {
    const refresh = () => setLast(lastBackupAt());
    refresh();
    setFolders(fsAccessSupported());
    window.addEventListener(AUTO_BACKUP_EVENT, refresh);
    return () => window.removeEventListener(AUTO_BACKUP_EVENT, refresh);
  }, []);

  if (last === undefined) return null;
  const text = backupNudge(last, Date.now(), jobCount);
  if (!text) return null;

  const download = async () => {
    setBusy(true);
    setError(null);
    try {
      const json = await exportBackup({ includeKey: false });
      downloadBlob(new Blob([json], { type: "application/json" }), `job-copilot-backup-${todayISO()}.json`);
      recordManualBackup();
      setLast(lastBackupAt());
    } catch (e) {
      setError(`Couldn't make the backup: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="-mt-5 mb-8 flex flex-wrap items-center gap-x-2 gap-y-1 px-1 text-[13px] text-muted" role="status">
      <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M12 4v11M7.5 10.5 12 15l4.5-4.5M5 19h14" />
      </svg>
      <span>{text}. Your data lives only in this browser.</span>
      <button type="button" onClick={download} disabled={busy} className={`${textButtonClass} text-[13px]`}>
        {busy ? "Preparing..." : "Download a backup"}
      </button>
      {folders && (
        <Link href="/settings#backup-and-restore" className={`${textButtonClass} text-[13px]`}>
          Back up automatically
        </Link>
      )}
      {error && <span className="w-full text-bad">{error}</span>}
    </div>
  );
}
