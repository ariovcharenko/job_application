"use client";

import { downloadBlob } from "@/lib/download";

import { useEffect, useState } from "react";
import { exportBackup, parseBackup, restoreBackup, type ParsedBackup } from "@/lib/backup";
import { todayISO } from "@/lib/tracker/stage";
import { forgetApiKeys, hasApiKey, isDeleteConfirmed, wipeAllData, DELETE_CONFIRM_WORD } from "@/lib/wipe";
import { Button, Card, ConfirmDialog, inputClass, Modal, Notice } from "@/components/ui";

type Status = { kind: "ok" | "error" | "info"; text: string } | null;

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** What a restore will bring in, in plain words, for the confirm dialog. */
function describeBackup(b: ParsedBackup, exportedAt: string): React.ReactNode {
  const date = new Date(exportedAt);
  const when = Number.isNaN(date.getTime()) ? "" : ` from ${date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}`;
  if (!b.tables) {
    return (
      <>
        <p>
          This older backup{when} has your settings, Profile, job preferences and experience only. They replace the ones in this
          browser. Your tracked jobs and resumes here are kept.
        </p>
        <p className="mt-3">{b.includesKey ? "It includes an API key, which replaces the one here." : "Your API key here is kept."}</p>
      </>
    );
  }
  const t = b.tables;
  return (
    <>
      <p>
        This backup{when} has {plural(t.applications.length, "job")}, {plural(t.tailoredResumes.length, "tailored resume")},{" "}
        {plural(t.contacts.length, "contact")} and {plural(t.answerBank.length, "saved answer")}, plus your settings, Profile, job
        preferences and experience.
      </p>
      <p className="mt-3">Everything in this browser is replaced with it. This can&apos;t be undone.</p>
      <p className="mt-3">{b.includesKey ? "It includes an API key, which replaces the one here." : "Your API key here is kept."}</p>
    </>
  );
}

export default function BackupCard() {
  const [includeKey, setIncludeKey] = useState(false);
  const [status, setStatus] = useState<Status>(null);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<{ parsed: ParsedBackup; exportedAt: string } | null>(null);
  const [keySaved, setKeySaved] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [typed, setTyped] = useState("");
  const [deleteError, setDeleteError] = useState("");

  useEffect(() => {
    void hasApiKey().then(setKeySaved);
  }, []);

  const download = async () => {
    setBusy(true);
    try {
      const text = await exportBackup({ includeKey });
      downloadBlob(new Blob([text], { type: "application/json" }), `job-copilot-backup-${todayISO()}.json`);
      setStatus({
        kind: "ok",
        text: includeKey
          ? "Backup downloaded. It contains your API key, so keep the file private."
          : "Backup downloaded. Your API key isn't in it: you'll paste it again after restoring.",
      });
    } catch (e) {
      setStatus({ kind: "error", text: `Couldn't make the backup: ${e instanceof Error ? e.message : String(e)}` });
    } finally {
      setBusy(false);
    }
  };

  const pickFile = async (file: File | undefined) => {
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = parseBackup(text);
      let exportedAt = "";
      try {
        exportedAt = String((JSON.parse(text) as { exportedAt?: string }).exportedAt ?? "");
      } catch {
        // parseBackup already accepted it; the date is only for the message.
      }
      setStatus(null);
      setPending({ parsed, exportedAt });
    } catch (e) {
      setStatus({ kind: "error", text: e instanceof Error ? e.message : String(e) });
    }
  };

  const restore = async () => {
    if (!pending) return;
    try {
      const r = await restoreBackup(pending.parsed);
      setPending(null);
      setStatus({
        kind: "ok",
        text: r.fullBackup ? `Restored ${plural(r.applications, "job")} and ${plural(r.tailoredResumes, "tailored resume")}. Reloading...` : "Restored. Reloading...",
      });
      setTimeout(() => window.location.reload(), 800);
    } catch (e) {
      setPending(null);
      setStatus({ kind: "error", text: `Nothing was changed. The restore failed: ${e instanceof Error ? e.message : String(e)}` });
    }
  };

  const forget = async () => {
    await forgetApiKeys();
    setKeySaved(false);
    setStatus({ kind: "ok", text: "Your API key was removed from this browser. Paste it again under Anthropic API key to keep checking jobs." });
  };

  const closeDelete = () => {
    setDeleting(false);
    setTyped("");
    setDeleteError("");
  };

  const wipe = async () => {
    if (!isDeleteConfirmed(typed)) return;
    setBusy(true);
    try {
      await wipeAllData();
    } catch (e) {
      setBusy(false);
      setDeleteError(
        `Couldn't delete the data: ${e instanceof Error ? e.message : String(e)}. Close any other tabs with this app open and try again.`,
      );
    }
  };

  return (
    <Card
      title="Backup and restore"
      hint="A backup file holds everything: settings, Profile, job preferences, your experience, saved answers, every job you've checked or tracked, tailored resumes and contacts. Use it to move to another browser or computer."
    >
      <Notice kind="info">Your data lives only in this browser. Back it up.</Notice>

      <div className="mt-5">
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" checked={includeKey} onChange={(e) => setIncludeKey(e.target.checked)} className="mt-0.5 h-4 w-4" />
          <span>
            Include my API key in the file
            <span className="block text-xs text-muted">Off by default. If you turn it on, keep that file private.</span>
          </span>
        </label>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Button onClick={download} disabled={busy}>
            Download backup
          </Button>
          <label className="inline-flex cursor-pointer items-center justify-center whitespace-nowrap rounded-full bg-black/[0.05] px-[18px] py-2 text-[14px] font-medium text-ink transition hover:bg-black/[0.08] focus-within:ring-4 focus-within:ring-accent/25">
            Restore from backup
            <input
              type="file"
              accept="application/json,.json"
              aria-label="Restore from a backup file"
              className="sr-only"
              onChange={(e) => {
                void pickFile(e.target.files?.[0]);
                // Let her pick the same file again after cancelling.
                e.target.value = "";
              }}
            />
          </label>
        </div>
      </div>
      {status && <Notice kind={status.kind}>{status.text}</Notice>}

      <h3 className="mt-8 text-sm font-semibold">Remove data from this browser</h3>
      <p className="mt-1 text-sm text-muted">
        Clearing this site&apos;s data in your browser settings does the same as Delete all my data.
      </p>
      <div className="mt-3 flex flex-wrap gap-3">
        <Button variant="secondary" onClick={() => void forget()} disabled={!keySaved}>
          Forget my API key
        </Button>
        <Button variant="danger-quiet" onClick={() => setDeleting(true)}>
          Delete all my data
        </Button>
      </div>

      {pending && (
        <ConfirmDialog
          title="Replace everything in this browser?"
          message={describeBackup(pending.parsed, pending.exportedAt)}
          confirmLabel="Replace everything"
          onCancel={() => setPending(null)}
          onConfirm={restore}
        />
      )}

      {deleting && (
        <Modal title="Delete all your data?" onClose={closeDelete} size="sm">
          <div className="text-[15px] leading-relaxed text-muted">
            <p>
              This deletes everything Job Copilot keeps in this browser: your API key, Profile, experience, preferences, every job and
              tailored resume. Files already saved to your computer are kept. This can&apos;t be undone.
            </p>
            <p className="mt-3">Download a backup first if you might want any of it back.</p>
          </div>
          <label className="mt-5 block text-sm">
            <span className="mb-1.5 block text-[13px] font-medium text-muted">
              Type {DELETE_CONFIRM_WORD} to confirm
            </span>
            <input
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void wipe();
                }
              }}
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              className={inputClass}
            />
          </label>
          {deleteError && <Notice kind="error">{deleteError}</Notice>}
          <div className="mt-6 flex justify-end gap-2">
            <Button variant="secondary" onClick={closeDelete}>
              Cancel
            </Button>
            <Button variant="danger" onClick={() => void wipe()} disabled={busy || !isDeleteConfirmed(typed)}>
              {busy ? "Deleting..." : "Delete everything"}
            </Button>
          </div>
        </Modal>
      )}
    </Card>
  );
}
