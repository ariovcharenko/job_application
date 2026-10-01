"use client";

import { useEffect, useState } from "react";
import { deleteBaseResume, getBaseResumes, getSettings, saveBaseResume } from "@/lib/db";
import { ensurePermission, fsAccessSupported, getBaseDir, hasPermission, listResumeFiles, readResumeFile, type ResumeFile } from "@/lib/fsAccess";
import { FEATURES } from "@/lib/features";
import { ROLE_TYPES, type BaseResume } from "@/lib/types";
import { Button, Card, ConfirmDialog, Notice } from "@/components/ui";

type Status = { kind: "ok" | "error" | "info"; text: string } | null;

/** Only the Chrome extension uses these files, so the card is hidden while it's out of the build. */
export default function BaseResumesCard() {
  if (!FEATURES.extension) return null;
  return <BaseResumesCardInner />;
}

function BaseResumesCardInner() {
  const [supported, setSupported] = useState(true);
  const [folder, setFolder] = useState<FileSystemDirectoryHandle | null>(null);
  const [needsPermission, setNeedsPermission] = useState(false);
  const [files, setFiles] = useState<ResumeFile[] | null>(null);
  const [imported, setImported] = useState<BaseResume[]>([]);
  const [status, setStatus] = useState<Status>(null);
  const [busy, setBusy] = useState<string | null>(null); // fileName currently importing
  const [removing, setRemoving] = useState<BaseResume | null>(null);

  const refresh = async () => {
    setImported(await getBaseResumes());
  };

  useEffect(() => {
    setSupported(fsAccessSupported());
    (async () => {
      const s = await getSettings();
      setFolder(s.resumeFolder ?? null);
      await refresh();
      // Only auto-scan if permission is already granted — requesting it needs a real click
      // (Chrome throws a SecurityError if requestPermission runs from a useEffect on mount).
      if (s.resumeFolder && (await hasPermission(s.resumeFolder, "read"))) {
        await scan(s.resumeFolder);
      } else if (s.resumeFolder) {
        setNeedsPermission(true);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const scan = async (root: FileSystemDirectoryHandle) => {
    setStatus({ kind: "info", text: "Checking access..." });
    if (!(await ensurePermission(root, "read"))) {
      setNeedsPermission(true);
      setStatus({ kind: "error", text: "Access denied. Click \"Change folder\" above and pick it again." });
      return;
    }
    setNeedsPermission(false);
    try {
      const base = await getBaseDir(root);
      const found = await listResumeFiles(base);
      setFiles(found);
      setStatus({ kind: "ok", text: `Access confirmed. ${found.length} resume file(s) found in "${base.name}".` });
    } catch (e) {
      setStatus({ kind: "error", text: e instanceof Error ? e.message : String(e) });
    }
  };

  const importFile = async (file: ResumeFile, label: string) => {
    if (!folder) return;
    setBusy(file.name);
    setStatus(null);
    try {
      const base = await getBaseDir(folder);
      const bytes = await readResumeFile(base, file.name);
      await saveBaseResume({ label, fileName: file.name, format: file.format, bytes, addedAt: Date.now() });
      await refresh();
      setStatus({ kind: "ok", text: `Imported "${file.name}".` });
    } catch (e) {
      setStatus({ kind: "error", text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(null);
    }
  };

  const relabel = async (resume: BaseResume, label: string) => {
    await saveBaseResume({ ...resume, label });
    await refresh();
  };

  const remove = async (resume: BaseResume) => {
    if (resume.id === undefined) return;
    await deleteBaseResume(resume.id);
    await refresh();
  };

  if (!supported) return null;

  const importedNames = new Set(imported.map((r) => r.fileName));
  const notYetImported = (files ?? []).filter((f) => !importedNames.has(f.name));

  return (
    <Card
      title="Base resumes"
      hint="Your ready-made resume files (.docx or PDF), labeled by job type. The Chrome extension uploads the newest one to application forms. Tailoring doesn't use these; it uses Your experience."
    >
      {!folder && <Notice kind="info">Pick a resume folder in the card below first.</Notice>}
      {folder && (
        <div className="mb-3 flex flex-wrap items-center gap-3">
          <Button variant="secondary" onClick={() => scan(folder)}>
            {needsPermission ? "Grant access" : "Re-check access"}
          </Button>
          {status && <Notice kind={status.kind}>{status.text}</Notice>}
        </div>
      )}

      {imported.length > 0 && (
        <div className="mb-4">
          <p className="mb-2 text-sm font-medium text-muted">Imported</p>
          <ul className="grid gap-2">
            {imported.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-black/10 px-3 py-2">
                <div className="min-w-0">
                  <p className="truncate text-sm">{r.fileName}</p>
                  <span className="rounded bg-black/5 px-1.5 py-0.5 text-xs uppercase text-muted">{r.format}</span>
                </div>
                <div className="flex items-center gap-2">
                  <select
                    aria-label={`Label for ${r.fileName}`}
                    value={r.label}
                    onChange={(e) => relabel(r, e.target.value)}
                    className="rounded-lg border border-black/[0.12] bg-white px-2 py-1 text-sm outline-none focus:border-accent focus:ring-4 focus:ring-accent/10"
                  >
                    {ROLE_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                  <Button variant="danger-quiet" onClick={() => setRemoving(r)}>
                    Remove
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {notYetImported.length > 0 && (
        <div>
          <p className="mb-2 text-sm font-medium text-muted">Found in folder, not imported yet</p>
          <ul className="grid gap-2">
            {notYetImported.map((f) => (
              <ImportRow key={f.name} file={f} busy={busy === f.name} onImport={(label) => importFile(f, label)} />
            ))}
          </ul>
        </div>
      )}

      {folder && files && files.length === 0 && imported.length === 0 && (
        <Notice kind="info">No .docx or .pdf files found in the Base folder.</Notice>
      )}
      {removing && (
        <ConfirmDialog
          title="Remove this base resume?"
          message={`"${removing.fileName}" will be removed from the app. The file in your folder is kept.`}
          confirmLabel="Remove"
          onCancel={() => setRemoving(null)}
          onConfirm={async () => {
            await remove(removing);
            setRemoving(null);
          }}
        />
      )}
    </Card>
  );
}

function ImportRow({ file, busy, onImport }: { file: ResumeFile; busy: boolean; onImport: (label: string) => void }) {
  const [label, setLabel] = useState<string>(ROLE_TYPES[0]);
  return (
    <li className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-black/10 px-3 py-2">
      <div className="min-w-0">
        <p className="truncate text-sm">{file.name}</p>
        <span className="rounded bg-black/5 px-1.5 py-0.5 text-xs uppercase text-muted">{file.format}</span>
      </div>
      <div className="flex items-center gap-2">
        <select
          aria-label={`Label for ${file.name}`}
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          className="rounded-lg border border-black/[0.12] bg-white px-2 py-1 text-sm outline-none focus:border-accent focus:ring-4 focus:ring-accent/10"
        >
          {ROLE_TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <Button onClick={() => onImport(label)} disabled={busy}>
          {busy ? "Importing..." : "Import"}
        </Button>
      </div>
    </li>
  );
}
