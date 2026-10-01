"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { isLocalHost, seedDemo, type DemoReport } from "@/lib/demo/seed";
import { Button, ConfirmDialog, Notice, PageHeader, Spinner } from "@/components/ui";

/**
 * Loads a made-up candidate (Riley Park) with jobs at every stage, tailored resumes, contacts and
 * saved answers, for showing the app off. Local copies only: on any other address it explains
 * and does nothing, so a real account can't be replaced by accident.
 */
export default function DemoView() {
  const [local, setLocal] = useState<boolean | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<DemoReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => setLocal(isLocalHost(location.hostname)), []);

  const load = async () => {
    setConfirming(false);
    setBusy(true);
    setError(null);
    try {
      setReport(await seedDemo());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader title="Demo account" subtitle="A made-up candidate with jobs at every stage, tailored one-page resumes, contacts and saved answers." />
      <div className="max-w-2xl rounded-[22px] bg-white p-6 shadow-soft sm:p-8">
        {local === false ? (
          <Notice kind="info">Demo data can only be loaded on a local copy of the app (localhost), so it can never replace a real account.</Notice>
        ) : (
          <>
            <p className="text-[15px] leading-relaxed">
              Loads Riley Park, a new grad in Seattle (fictional), with 8 jobs: an offer, an interview, two applied, one saved, one
              rejected, one checked and one skipped. Six have a resume tailored and fitted to a full page.
            </p>
            <p className="mt-3 text-sm text-muted">
              It replaces every job, resume, contact and saved answer in this browser, plus the Profile, preferences and experience. Your
              API key and other settings are kept. No AI call is made.
            </p>
            <div className="mt-5">
              <Button onClick={() => setConfirming(true)} disabled={busy || local === null}>
                {busy ? "Loading…" : report ? "Load it again" : "Load demo account"}
              </Button>
            </div>
            {busy && (
              <div className="mt-4">
                <Spinner label="Fitting each resume to the page" />
              </div>
            )}
            {error && <Notice kind="error">{error}</Notice>}
            {report && (
              <div className="mt-5">
                <Notice kind="ok">
                  Loaded {report.jobs} jobs and {report.resumes.length} resumes.{" "}
                  <Link href="/" className="font-medium underline">
                    Open the tracker
                  </Link>
                </Notice>
                <ul className="mt-3 grid gap-1 text-sm">
                  {report.resumes.map((r) => (
                    <li key={r.company} className="flex justify-between gap-4">
                      <span>{r.company}</span>
                      <span className={`tabular-nums ${r.fits && r.fill >= 0.95 ? "text-good" : "text-warn"}`}>
                        {r.fits ? `fills ${Math.round(r.fill * 100)}% of the page` : "over one page"} · {r.body}pt
                        {r.flags ? ` · ${r.flags} flag${r.flags === 1 ? "" : "s"}` : ""}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}
      </div>
      {confirming && (
        <ConfirmDialog
          title="Replace this browser's data with the demo?"
          confirmLabel="Load demo"
          onConfirm={load}
          onCancel={() => setConfirming(false)}
          message="Every job, resume, contact and saved answer here is replaced, along with the Profile, preferences and experience. Your API key is kept. Automatic backups from this copy go to its own localhost files."
        />
      )}
    </>
  );
}
