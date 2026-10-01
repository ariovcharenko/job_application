"use client";

import { useEffect, useRef, useState } from "react";
import { getProfile } from "@/lib/db";
import { downloadBlob } from "@/lib/download";
import { parseStoredResume } from "@/lib/resume/engine/save";
import { getCurrentResume } from "@/lib/resume/ownResume";
import { tailoredFileName } from "@/lib/resume/repo";
import type { Application } from "@/lib/types";
import { Button, Modal, Notice, Spinner } from "@/components/ui";
import ResumePreview from "./ResumePreview";

const MIME = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
} as const;

type Current = NonNullable<Awaited<ReturnType<typeof getCurrentResume>>>;

/** Her own Word file, drawn in the page by docx-preview (loaded only when needed). */
function DocxView({ bytes }: { bytes: ArrayBuffer }) {
  const ref = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { renderAsync } = await import("docx-preview");
        if (cancelled || !ref.current) return;
        ref.current.innerHTML = "";
        await renderAsync(bytes, ref.current, undefined, { inWrapper: true, ignoreLastRenderedPageBreak: true, experimental: false });
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [bytes]);
  if (failed) return <Notice kind="info">This Word file can&apos;t be previewed here. Download it to open it in Word.</Notice>;
  return <div ref={ref} className="max-h-[70vh] overflow-auto rounded-xl bg-paper ring-1 ring-black/[0.08]" aria-label="Resume preview" />;
}

/** Her own PDF, shown with the browser's PDF viewer from a local blob: URL (nothing is uploaded). */
function PdfView({ bytes }: { bytes: ArrayBuffer }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    const u = URL.createObjectURL(new Blob([bytes], { type: MIME.pdf }));
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [bytes]);
  return url ? <iframe src={url} title="Resume (PDF)" className="h-[70vh] w-full rounded-xl bg-paper ring-1 ring-black/[0.08]" /> : null;
}

/**
 * The job's resume, previewed in place: a tailored resume as its page, her own PDF or Word file as
 * itself. Download is a separate, explicit button.
 */
export default function JobResumeDialog({ app, onClose }: { app: Application; onClose: () => void }) {
  const [current, setCurrent] = useState<Current | null | undefined>(undefined);
  const [width, setWidth] = useState(612);

  useEffect(() => {
    getCurrentResume(app).then(setCurrent);
  }, [app]);

  // Fit the tailored page to the dialog on narrow screens.
  useEffect(() => {
    const fit = () => setWidth(Math.min(612, window.innerWidth - 80));
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, []);

  const download = async () => {
    if (!current) return;
    const name = current.own?.fileName ?? current.savedPath ?? tailoredFileName((await getProfile()).fullName, app.company, app.role);
    downloadBlob(new Blob([current.bytes], { type: MIME[current.format] }), name);
  };

  const engine = current && !current.own ? parseStoredResume(current.appliedEdits) : null;
  const title = `Resume${app.company ? ` for ${app.company}` : ""}`;

  return (
    <Modal title={title} onClose={onClose}>
      {current === undefined ? (
        <Spinner />
      ) : current === null ? (
        <p className="text-sm text-muted">This job has no resume yet.</p>
      ) : (
        <>
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <p className="text-[13px] text-muted">
              {current.own ? `Your file: ${current.own.fileName}` : "Tailored for this job"} · saved {new Date(current.createdAt).toLocaleDateString()}
            </p>
            <Button variant="secondary" onClick={download}>
              Download {current.own ? (current.format === "pdf" ? "PDF" : ".docx") : ".docx"}
            </Button>
          </div>
          {current.own ? (
            current.format === "pdf" ? (
              <PdfView bytes={current.bytes} />
            ) : (
              <DocxView bytes={current.bytes} />
            )
          ) : engine ? (
            <div className="flex justify-center">
              <ResumePreview doc={engine.final} width={width} />
            </div>
          ) : (
            <DocxView bytes={current.bytes} />
          )}
        </>
      )}
    </Modal>
  );
}
