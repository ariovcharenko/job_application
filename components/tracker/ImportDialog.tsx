"use client";

import { useState } from "react";
import { importCsv, type ImportResult } from "@/lib/tracker/csvMap";
import { importApplications } from "@/lib/tracker/repo";
import { Button, Modal, Notice } from "@/components/ui";

export default function ImportDialog({ onClose }: { onClose: () => void }) {
  const [result, setResult] = useState<ImportResult | null>(null);
  const [done, setDone] = useState<{ added: number; skipped: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);

  const onFile = async (file: File | undefined) => {
    setError(null);
    setResult(null);
    if (!file) return;
    try {
      setResult(importCsv(await file.text()));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <Modal title="Import from a CSV" onClose={onClose}>
      {!done && (
        <>
          <p className="text-sm text-muted">
            From Notion, Airtable, Google Sheets or Excel. You&apos;ll see a preview first, and rows you already have are skipped.
          </p>
          <input
            type="file"
            accept=".csv,text/csv"
            aria-label="CSV file"
            onChange={(e) => onFile(e.target.files?.[0])}
            className="mt-4 text-sm"
          />
        </>
      )}

      {error && <Notice kind="error">{error}</Notice>}

      {result && !done && (
        <div className="mt-4 text-sm">
          {result.applications.length === 0 ? (
            <Notice kind="error">No rows found. Is this the right file? It needs a header row.</Notice>
          ) : (
            <>
              <p className="font-medium">{result.applications.length} row(s) ready to import.</p>
              <p className="mt-2 text-muted">
                Matched columns:{" "}
                {Object.entries(result.mapped)
                  .map(([h, f]) => `${h} → ${f}`)
                  .join(", ")}
              </p>
              {result.unmapped.length > 0 && (
                <p className="mt-1 text-warn">
                  Not recognised (values will be kept in Notes): {result.unmapped.join(", ")}
                </p>
              )}
              <ul className="mt-3 max-h-48 overflow-auto rounded-md border border-black/10 p-2">
                {result.applications.slice(0, 8).map((a, i) => (
                  <li key={i} className="py-0.5">
                    <strong>{a.company || "—"}</strong> · {a.role || "—"} · {a.stage}
                    {a.appliedDate && ` · ${a.appliedDate}`}
                  </li>
                ))}
                {result.applications.length > 8 && (
                  <li className="text-muted">…and {result.applications.length - 8} more</li>
                )}
              </ul>
              <div className="mt-4">
                <Button
                  disabled={importing}
                  onClick={async () => {
                    setImporting(true);
                    try {
                      setDone(await importApplications(result.applications));
                    } catch (e) {
                      setError(e instanceof Error ? e.message : String(e));
                    } finally {
                      setImporting(false);
                    }
                  }}
                >
                  Import {result.applications.length} row(s)
                </Button>
              </div>
            </>
          )}
        </div>
      )}

      {done && (
        <div className="text-sm">
          <Notice kind="ok">
            Added {done.added} application(s){done.skipped > 0 ? `, skipped ${done.skipped} duplicate(s)` : ""}.
          </Notice>
          <div className="mt-4">
            <Button onClick={onClose}>Done</Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
