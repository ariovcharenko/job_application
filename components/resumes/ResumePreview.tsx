"use client";

import { useEffect, useState } from "react";
import { getProfile } from "@/lib/db";
import { buildHeader, type ResumeDoc, type ResumeHeader } from "@/lib/resume/engine";
import { PAGE_CSS, renderResumeHtml } from "@/lib/resume/engine/html";

/** A scaled, read-only picture of a tailored resume page (the same HTML the one-page check uses). */
export default function ResumePreview({ doc, width = 240 }: { doc: ResumeDoc; width?: number }) {
  const [header, setHeader] = useState<ResumeHeader | null>(null);
  useEffect(() => {
    getProfile().then((p) => setHeader(buildHeader(p)));
  }, []);
  const scale = width / (8.5 * 96);
  return (
    <div
      className="overflow-hidden rounded-lg bg-white shadow-lift ring-1 ring-black/[0.06]"
      style={{ width, height: 11 * 96 * scale }}
      aria-label="Resume preview"
    >
      {header && (
        <div style={{ transform: `scale(${scale})`, transformOrigin: "top left", width: "8.5in" }}>
          <style>{PAGE_CSS}</style>
          {/* renderResumeHtml escapes every string; no model output is inserted as raw HTML. */}
          <div dangerouslySetInnerHTML={{ __html: renderResumeHtml(header, doc) }} />
        </div>
      )}
    </div>
  );
}
