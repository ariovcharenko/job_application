"use client";

import { useEffect, useState } from "react";
import { AUTO_BACKUP_EVENT, KEEP_DAYS, lastAutoBackupAt, runAutoBackup, type AutoBackupStatus } from "@/lib/autoBackup";
import { getSettings, saveSettings } from "@/lib/db";
import { ensurePermission, fsAccessSupported, hasPermission, pickFolder } from "@/lib/fsAccess";
import { Button, Notice } from "@/components/ui";

const when = (at: number) => new Date(at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

/**
 * Automatic backups to a folder she picks (lib/autoBackup.ts). Picking the folder and re-allowing
 * access are clicks, because the browser only asks for folder permission from a click.
 */
export default function AutoBackupSection() {
  const [status, setStatus] = useState<AutoBackupStatus | null>(null);
  const [busy, setBusy] = useState(false);
  // Known only in the browser; starts true so the first render matches the server's.
  const [supported, setSupported] = useState(true);

  useEffect(() => {
    setSupported(fsAccessSupported());
    (async () => {
      const dir = (await getSettings()).backupFolder;
      if (!dir) return setStatus({ kind: "off" });
      if (!(await hasPermission(dir))) return setStatus({ kind: "needs-permission", folder: dir.name });
      const at = lastAutoBackupAt();
      setStatus(at ? { kind: "saved", folder: dir.name, at } : await runAutoBackup());
    })();
    const onRun = (e: Event) => setStatus((e as CustomEvent<AutoBackupStatus>).detail);
    window.addEventListener(AUTO_BACKUP_EVENT, onRun);
    return () => window.removeEventListener(AUTO_BACKUP_EVENT, onRun);
  }, []);

  const choose = async () => {
    setBusy(true);
    try {
      const dir = await pickFolder();
      if (!dir) return;
      await saveSettings({ backupFolder: dir });
      setStatus(await runAutoBackup());
    } finally {
      setBusy(false);
    }
  };

  const allow = async () => {
    setBusy(true);
    try {
      const dir = (await getSettings()).backupFolder;
      if (dir && (await ensurePermission(dir))) setStatus(await runAutoBackup());
    } finally {
      setBusy(false);
    }
  };

  const stop = async () => {
    await saveSettings({ backupFolder: undefined });
    setStatus({ kind: "off" });
  };

  if (!supported) {
    return (
      <Notice kind="info">
        Automatic backups need Chrome or Edge on a computer. In this browser, download a backup below every so often.
      </Notice>
    );
  }

  return (
    <section className="rounded-2xl border border-black/[0.08] p-5" aria-labelledby="auto-backup-title">
      <h3 id="auto-backup-title" className="text-[15px] font-semibold tracking-display">
        Automatic backup
      </h3>
      <p className="mt-1 text-[13px] leading-relaxed text-muted">
        Saves everything (every job, tailored resume, your Profile, experience, saved answers and contacts, never your API key) to a
        folder on this computer whenever something changes. Keeps one file per day for the last {KEEP_DAYS} days, plus the latest.
      </p>
      <div className="mt-3 text-sm" aria-live="polite">
        {status?.kind === "saved" && (
          <p>
            On. Last saved {when(status.at)} to the <span className="font-medium">{status.folder}</span> folder.
          </p>
        )}
        {status?.kind === "needs-permission" && (
          <p className="text-warn">The browser needs your OK again to write to the {status.folder} folder.</p>
        )}
        {status?.kind === "error" && <p className="text-bad">Couldn&apos;t write the backup: {status.message}</p>}
        {status?.kind === "off" && <p className="text-muted">Off. Pick a folder to turn it on.</p>}
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {status?.kind === "needs-permission" && (
          <Button onClick={allow} disabled={busy}>
            Allow and back up now
          </Button>
        )}
        <Button variant={status?.kind === "off" ? "primary" : "secondary"} onClick={choose} disabled={busy}>
          {status?.kind === "off" || !status ? "Choose backup folder" : "Change folder"}
        </Button>
        {status && status.kind !== "off" && (
          <Button variant="danger-quiet" onClick={stop} disabled={busy}>
            Turn off
          </Button>
        )}
      </div>
      <p className="mt-3 text-xs text-muted">
        Tip: pick a folder that&apos;s not inside your browser&apos;s data (for example Documents/Job Copilot Backups). When Chrome
        asks, choose &ldquo;Allow on every visit&rdquo; so backups keep running without asking.
      </p>
    </section>
  );
}
