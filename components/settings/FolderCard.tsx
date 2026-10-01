"use client";

import { useEffect, useState } from "react";
import { getSettings, saveSettings } from "@/lib/db";
import { ensurePermission, fsAccessSupported, listResumeFiles, pickFolder, type ResumeFile } from "@/lib/fsAccess";
import { FEATURES } from "@/lib/features";
import { Button, Card, Notice } from "@/components/ui";

type Status = { kind: "ok" | "error" | "info"; text: string } | null;

export default function FolderCard() {
  const [handle, setHandle] = useState<FileSystemDirectoryHandle | null>(null);
  const [files, setFiles] = useState<ResumeFile[] | null>(null);
  const [status, setStatus] = useState<Status>(null);
  // Unknown until mounted (the API only exists in the browser); the card shows nothing until then,
  // and nothing at all where folder access isn't supported (Safari, Firefox, phones).
  const [supported, setSupported] = useState<boolean | null>(null);

  useEffect(() => {
    const ok = fsAccessSupported();
    setSupported(ok);
    if (ok) getSettings().then((s) => setHandle(s.resumeFolder ?? null));
  }, []);

  const scan = async (h: FileSystemDirectoryHandle) => {
    setStatus({ kind: "info", text: "Checking access..." });
    if (!(await ensurePermission(h))) {
      setFiles(null);
      setStatus({ kind: "error", text: "Access denied. Click \"Change folder\" and pick it again." });
      return;
    }
    if (!FEATURES.extension) {
      // Only downloads are copied here, so there's nothing in it to list.
      setStatus({ kind: "ok", text: "Access confirmed. Tailored resumes you download are also saved here." });
      return;
    }
    try {
      const found = await listResumeFiles(h);
      setFiles(found);
      setStatus({ kind: "ok", text: `Access confirmed. ${found.length} resume file(s) found.` });
    } catch (e) {
      setStatus({ kind: "error", text: e instanceof Error ? e.message : String(e) });
    }
  };

  const choose = async () => {
    try {
      const h = await pickFolder();
      if (!h) return;
      await saveSettings({ resumeFolder: h });
      setHandle(h);
      await scan(h);
    } catch (e) {
      setStatus({ kind: "error", text: e instanceof Error ? e.message : String(e) });
    }
  };

  if (!supported) return null;

  return (
    <Card
      title="Resume folder"
      hint={
        FEATURES.extension
          ? "Optional. The folder on your computer that holds your resumes. Base resumes are imported from it, and downloaded tailored resumes are also copied into its Tailored subfolder."
          : "Optional. A folder on your computer where each tailored resume you download is also copied, into a Tailored subfolder."
      }
    >
      <p className="text-sm">
        Current folder: <strong>{handle ? handle.name : "none chosen"}</strong>
      </p>
      <div className="mt-3 flex flex-wrap gap-3">
        <Button onClick={choose}>
          {handle ? "Change folder" : "Choose folder"}
        </Button>
        {handle && (
          <Button variant="secondary" onClick={() => scan(handle)}>
            Check access
          </Button>
        )}
      </div>
      {status && <Notice kind={status.kind}>{status.text}</Notice>}
      {files && files.length > 0 && (
        <div className="mt-4 text-sm">
          <p className="text-muted">
            {files.filter((f) => f.format === "docx").length} Word, {files.filter((f) => f.format === "pdf").length} PDF:
          </p>
          <ul className="mt-1 max-h-48 list-disc overflow-auto pl-5">
            {files.map((f) => (
              <li key={f.name}>
                {f.name}{" "}
                <span className="rounded bg-black/5 px-1.5 py-0.5 text-xs uppercase text-muted">{f.format}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {files && files.length === 0 && (
        <p className="mt-2 text-sm text-warn">
          No .docx or .pdf files in this folder itself. If your resumes are in a subfolder (like Base), pick that
          subfolder instead.
        </p>
      )}
    </Card>
  );
}
