"use client";

import { useEffect, useId, useMemo, useState } from "react";
import { getProvider } from "@/lib/ai";
import { getProfile } from "@/lib/db";
import { pastedSource, readResumeUpload, ResumeFileError, type ResumeSource } from "@/lib/resume/master/extractText";
import {
  checkImport,
  contactOffers,
  IMPORT_COST_HINT,
  importResume,
  saveImport,
  type ContactField,
  type ContactOffer,
  type ImportResult,
} from "@/lib/resume/master/fromResume";
import { Button, Checkbox, ConfirmDialog, inputClass, Modal, Notice, Spinner } from "@/components/ui";
import AIErrorNotice from "./AIErrorNotice";

type Stage = "closed" | "pick" | "reading" | "review";

/**
 * "Import from my resume" at the top of the Your experience card: pick a PDF, Word or text file
 * (or paste), spend one AI call after she sees the cost, then review the result beside the original.
 * Nothing is saved until "Use this"; replacing what's already there asks first.
 */
export default function ResumeImport({ current, onImported }: { current: string; onImported: (text: string) => void }) {
  const [stage, setStage] = useState<Stage>("closed");
  const [mode, setMode] = useState<"file" | "paste">("file");
  const [source, setSource] = useState<ResumeSource | null>(null);
  const [pasted, setPasted] = useState("");
  const [fileError, setFileError] = useState<string | null>(null);
  const [aiError, setAiError] = useState<unknown>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const inputId = useId();

  const reset = () => {
    setStage("closed");
    setMode("file");
    setSource(null);
    setPasted("");
    setFileError(null);
    setAiError(null);
    setResult(null);
  };

  const onFile = async (file: File | undefined) => {
    setFileError(null);
    setSource(null);
    if (!file) return;
    try {
      setSource(await readResumeUpload(file));
    } catch (e) {
      setFileError(e instanceof ResumeFileError ? e.message : `Couldn't read that file: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const read = async () => {
    setFileError(null);
    setAiError(null);
    let src = source;
    if (mode === "paste") {
      try {
        src = pastedSource(pasted);
        setSource(src);
      } catch (e) {
        setFileError(e instanceof Error ? e.message : String(e));
        return;
      }
    }
    if (!src) return;
    setStage("reading");
    try {
      setResult(await importResume(await getProvider(), src));
      setStage("review");
    } catch (e) {
      setAiError(e);
      setStage("pick");
    }
  };

  if (stage === "closed") {
    return (
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-paper p-4">
        <div className="min-w-0 flex-1 basis-60">
          <p className="text-[15px] font-medium">Start from your resume</p>
          <p className="text-sm text-muted">Upload a PDF, Word or text file and it&apos;s typed in below for you to check. Costs {IMPORT_COST_HINT}.</p>
        </div>
        <Button variant="secondary" onClick={() => setStage("pick")}>
          Import from my resume
        </Button>
      </div>
    );
  }

  if (stage === "reading") {
    return (
      <div className="mb-6 rounded-2xl bg-accent-soft/40 p-4">
        <Spinner label="Reading your resume. This usually takes 30 to 90 seconds..." />
      </div>
    );
  }

  const canRead = mode === "file" ? !!source : pasted.trim().length > 0;

  return (
    <>
      <div className="mb-6 rounded-2xl bg-paper p-4 sm:p-5">
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <p className="text-[15px] font-medium">Import from my resume</p>
          <div className="flex gap-1 rounded-full bg-black/[0.05] p-0.5 text-[13px]" role="group" aria-label="How to add your resume">
            {(["file", "paste"] as const).map((m) => (
              <button
                key={m}
                type="button"
                aria-pressed={mode === m}
                onClick={() => {
                  setMode(m);
                  setFileError(null);
                }}
                className={`rounded-full px-3 py-1 font-medium transition focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-accent/25 ${mode === m ? "bg-white text-ink shadow-soft" : "text-muted hover:text-ink"}`}
              >
                {m === "file" ? "Upload a file" : "Paste text"}
              </button>
            ))}
          </div>
        </div>

        {mode === "file" ? (
          <div
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              void onFile(e.dataTransfer.files[0]);
            }}
            className="rounded-xl border border-dashed border-black/15 bg-white p-4 text-center"
          >
            <input
              id={inputId}
              type="file"
              accept=".pdf,.docx,.txt,.md,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain"
              className="peer sr-only"
              onChange={(e) => {
                void onFile(e.target.files?.[0]);
                e.target.value = "";
              }}
            />
            <label
              htmlFor={inputId}
              className="inline-flex cursor-pointer items-center gap-1.5 rounded-full bg-black/[0.05] px-[18px] py-2 text-[14px] font-medium transition hover:bg-black/[0.08] peer-focus-visible:ring-4 peer-focus-visible:ring-accent/25"
            >
              <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M8 10.5V2.5M4.5 6 8 2.5 11.5 6M2.5 10.5v2a1 1 0 0 0 1 1h9a1 1 0 0 0 1-1v-2" />
              </svg>
              {source ? "Choose another file" : "Choose a file"}
            </label>
            <p className="mt-2 break-words text-sm text-muted">
              {source ? <span className="font-medium text-ink">{source.fileName}</span> : "PDF, Word (.docx) or text, up to 5 MB. Or drop it here."}
            </p>
          </div>
        ) : (
          <textarea
            aria-label="Your resume's text"
            value={pasted}
            onChange={(e) => setPasted(e.target.value)}
            rows={8}
            placeholder="Paste your whole resume here"
            className={`${inputClass} text-[14px]`}
          />
        )}

        {fileError && <Notice kind="error">{fileError}</Notice>}
        {aiError !== null && <AIErrorNotice error={aiError} />}

        <p className="mt-3 text-sm text-muted">
          It&apos;s copied as written, not improved. Add more than fits on one page: every role, every bullet. Tailoring picks from this.
        </p>
        <div className="mt-3 flex flex-wrap justify-end gap-2">
          <Button variant="secondary" onClick={reset}>
            Cancel
          </Button>
          <Button onClick={read} disabled={!canRead}>
            Read my resume ({IMPORT_COST_HINT})
          </Button>
        </div>
      </div>

      {stage === "review" && result && source && (
        <ImportReview
          source={source}
          result={result}
          replacing={current.trim().length > 0}
          onCancel={reset}
          onSaved={(text) => {
            onImported(text);
            reset();
          }}
        />
      )}
    </>
  );
}

function ImportReview({
  source,
  result,
  replacing,
  onCancel,
  onSaved,
}: {
  source: ResumeSource;
  result: ImportResult;
  replacing: boolean;
  onCancel: () => void;
  onSaved: (text: string) => void;
}) {
  const [text, setText] = useState(result.masterProfile);
  const [offers, setOffers] = useState<ContactOffer[] | null>(null);
  const [ticked, setTicked] = useState<Set<ContactField>>(new Set());
  const [numbersOk, setNumbersOk] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);

  useEffect(() => {
    getProfile().then((p) => {
      const o = contactOffers(p, result.contact);
      setOffers(o);
      setTicked(new Set(o.map((x) => x.key)));
    });
  }, [result.contact]);

  useEffect(() => {
    if (source.kind !== "pdf") return;
    const url = URL.createObjectURL(new Blob([source.bytes], { type: "application/pdf" }));
    setPdfUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [source]);

  const check = useMemo(() => checkImport(text, source.kind === "text" ? source.text : null), [text, source]);
  const numbers = check.numbers ?? [];
  const blocked = check.missing.length > 0 || (numbers.length > 0 && !numbersOk);

  const save = async () => {
    setError(null);
    try {
      await saveImport(text, result.contact, [...ticked]);
      onSaved(text.trim());
    } catch (e) {
      setError(`Couldn't save: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  return (
    <Modal title="Check your experience" onClose={onCancel}>
      <p className="text-[15px] leading-relaxed text-muted">
        Compare it with your resume and fix anything that&apos;s off. Add more than fits on one page: every role, every bullet. Tailoring picks from this.
      </p>

      <div className="mt-4 grid min-w-0 gap-4 md:grid-cols-2">
        <section className="min-w-0" aria-label="Your original resume">
          <p className="mb-1.5 text-[13px] font-medium text-muted">Your file: {source.fileName}</p>
          {source.kind === "pdf" ? (
            pdfUrl ? (
              <iframe src={pdfUrl} title="Your resume (PDF)" className="h-[50vh] w-full rounded-xl bg-paper ring-1 ring-black/[0.08] md:h-[60vh]" />
            ) : null
          ) : (
            <pre className="h-[40vh] overflow-auto whitespace-pre-wrap break-words rounded-xl bg-paper p-3 font-sans text-[13px] leading-relaxed md:h-[60vh]">{source.text}</pre>
          )}
        </section>
        <section className="min-w-0">
          <label className="block">
            <span className="mb-1.5 block text-[13px] font-medium text-muted">Your experience (edit freely)</span>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              spellCheck
              className={`${inputClass} h-[50vh] text-[14px] leading-relaxed md:h-[60vh]`}
            />
          </label>
        </section>
      </div>

      <div className="mt-4 grid gap-3" aria-live="polite">
        {check.missing.map((m) => (
          <p key={m} className="rounded-2xl bg-bad-soft px-4 py-3 text-sm text-bad">
            {m}
          </p>
        ))}
        {check.missing.length === 0 && (
          <p className="text-sm text-good">
            Found {check.roles} role{check.roles === 1 ? "" : "s"} and {check.skills} skill{check.skills === 1 ? "" : "s"}.
          </p>
        )}

        {check.numbers === null ? (
          <Notice kind="info">Check the numbers against your PDF on the left. They can&apos;t be compared automatically for a PDF.</Notice>
        ) : numbers.length > 0 ? (
          <div className="rounded-2xl bg-warn-soft p-4 text-sm">
            <p className="font-medium text-warn">
              {numbers.length === 1 ? "This number isn't" : "These numbers aren't"} in your original. Fix {numbers.length === 1 ? "it" : "them"} above, or confirm below.
            </p>
            <ul className="mt-2 grid gap-1">
              {numbers.map((n, i) => (
                <li key={`${n.line}-${n.number}-${i}`} className="break-words">
                  <mark className="rounded bg-warn/15 px-1 font-semibold text-ink">{n.number}</mark>{" "}
                  <span className="text-muted">
                    line {n.line}: {n.text}
                  </span>
                </li>
              ))}
            </ul>
            <div className="mt-3">
              <Checkbox label="I checked these numbers. They're right." checked={numbersOk} onChange={setNumbersOk} />
            </div>
          </div>
        ) : (
          <p className="text-sm text-good">Every number matches your original.</p>
        )}

        {check.legalLines.length > 0 && (
          <div className="rounded-2xl bg-warn-soft p-4 text-sm">
            <p className="font-medium text-warn">These lines mention work authorization or personal status.</p>
            <p className="mt-1 text-muted">Tailoring doesn&apos;t need them, and applications only use the answers you set in Profile. Remove them unless they belong on a resume.</p>
            <ul className="mt-2 grid gap-1 text-muted">
              {check.legalLines.map((l) => (
                <li key={l.line} className="break-words">
                  line {l.line}: {l.text}
                </li>
              ))}
            </ul>
          </div>
        )}

        {offers && offers.length > 0 && (
          <div className="rounded-2xl bg-paper p-4">
            <p className="text-sm font-medium">Also fill these empty Profile fields</p>
            <p className="mb-3 text-xs text-muted">Fields you already filled in are left alone. Work authorization, sponsorship and demographic answers are never taken from a resume.</p>
            <div className="grid gap-2">
              {offers.map((o) => (
                <Checkbox
                  key={o.key}
                  label={
                    <span className="break-all">
                      <span className="font-medium">{o.label}:</span> {o.value}
                    </span>
                  }
                  checked={ticked.has(o.key)}
                  onChange={(on) =>
                    setTicked((s) => {
                      const next = new Set(s);
                      if (on) next.add(o.key);
                      else next.delete(o.key);
                      return next;
                    })
                  }
                />
              ))}
            </div>
          </div>
        )}
      </div>

      {error && <Notice kind="error">{error}</Notice>}

      <div className="mt-5 flex flex-wrap justify-end gap-2">
        <Button variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        <Button onClick={() => (replacing ? setConfirming(true) : void save())} disabled={blocked}>
          Use this
        </Button>
      </div>

      {confirming && (
        <ConfirmDialog
          title="Replace your experience?"
          message="What's in Your experience now will be replaced by this imported version. Copy it somewhere first if you want to keep it."
          confirmLabel="Replace"
          onCancel={() => setConfirming(false)}
          onConfirm={async () => {
            setConfirming(false);
            await save();
          }}
        />
      )}
    </Modal>
  );
}
