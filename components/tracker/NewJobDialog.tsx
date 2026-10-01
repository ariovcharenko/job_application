"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { getProvider } from "@/lib/ai";
import { AIError } from "@/lib/ai/provider";
import { db, getMasterProfile, getPreferences, getProfile } from "@/lib/db";
import { loadGeo, type GeoIndex } from "@/lib/geo/index";
import { analyzeJob, assessJob, looksLikeUrl, readJobPosting, toStoredBreakdown, type JobAnalysis } from "@/lib/intake/analyze";
import { findExistingJob } from "@/lib/intake/dedupe";
import { saveAnalyzedJob, type SavedJob } from "@/lib/intake/save";
import { verdictFor, VERDICT_TEXT } from "@/lib/intake/decision";
import { readBreakdown } from "@/lib/intake/stored";
import { saveApplication } from "@/lib/tracker/repo";
import { skipJob, trackJob } from "@/lib/tracker/triage";
import { todayISO } from "@/lib/tracker/stage";
import type { Application, Preferences, Profile } from "@/lib/types";
import { Button, Field, Modal, Notice, Spinner, TextArea } from "@/components/ui";
import TailorPanel from "../tailor/TailorPanel";
import MustHavesPanel from "./MustHavesPanel";
import ScoreCard from "./ScoreCard";

type Mode = "link" | "paste";

/** Shown when she enters a link she already checked, before anything is spent on it again. */
function AlreadyChecked({
  app,
  onOpen,
  onCheckAgain,
}: {
  app: Application & { id: number };
  onOpen?: (app: Application & { id: number }) => void;
  onCheckAgain: () => void;
}) {
  const b = readBreakdown(app);
  const pct = b?.skills?.percent ?? null;
  const verdict = b?.decision ? VERDICT_TEXT[verdictFor(b.decision, pct)].label : null;
  const when = new Date(app.updatedAt || app.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  const where = app.triage === "skipped" ? "marked as not applying" : app.triage === "checked" ? "under Checked jobs" : `in your applications (${app.stage})`;
  return (
    <div className="mt-4 rounded-2xl bg-accent-soft/60 p-5" role="status">
      <p className="font-semibold tracking-display">You already checked this position</p>
      <p className="mt-1 text-sm text-muted">
        {app.role || "This job"}
        {app.company ? ` at ${app.company}` : ""}, on {when}
        {verdict ? `: ${pct === null ? "" : `${pct}% · `}${verdict}` : ""}. It&apos;s {where}.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        {onOpen && <Button onClick={() => onOpen(app)}>Open it</Button>}
        <Button variant="secondary" onClick={onCheckAgain}>
          Check it again (1 to 2¢)
        </Button>
      </div>
    </div>
  );
}

/**
 * Add a job from its link (or pasted text): read it, check it against her must-haves, show how
 * much of its skill list she has, add it to the tracker, and offer a "Tailor resume" button.
 * Changing a must-have re-checks the job instantly: that part is plain code, not an AI call.
 */
export default function NewJobDialog({
  onClose,
  initialJdText = "",
  initialUrl = "",
  autoAnalyze = false,
  initialMode,
  updateId,
  onOpenExisting,
}: {
  onClose: () => void;
  /** Prefills the paste box — used when a job posting was captured via the Chrome extension. */
  initialJdText?: string;
  initialUrl?: string;
  /** Start reading the link immediately (it came from the Tracker's link box). */
  autoAnalyze?: boolean;
  /** Open on "paste the description" even with no text yet (re-checking a job whose link couldn't be read). */
  initialMode?: Mode;
  /** Re-check this tracker row in place (it may have no link, or she may edit the link). */
  updateId?: number;
  /** Open a job she already checked (offered when she enters a link she has checked before). */
  onOpenExisting?: (app: Application & { id: number }) => void;
}) {
  const [mode, setMode] = useState<Mode>(initialMode ?? (initialJdText ? "paste" : "link"));
  const [url, setUrl] = useState(initialUrl);
  const [jdText, setJdText] = useState(initialJdText);
  const [step, setStep] = useState<string | null>(null);
  const [error, setError] = useState<{ message: string; needsKey: boolean } | null>(null);
  const [analysis, setAnalysis] = useState<JobAnalysis | null>(null);
  const [app, setApp] = useState<SavedJob | null>(null);
  // A link she already checked: shown before spending anything on it again.
  const [previous, setPrevious] = useState<(Application & { id: number }) | null>(null);
  const [prefs, setPrefs] = useState<Preferences | null>(null);
  const [master, setMaster] = useState("");
  const [profile, setProfile] = useState<Profile | null>(null);
  const [geo, setGeo] = useState<GeoIndex | null>(null);

  // Her Profile (work authorization, degree) and the place names, for the free re-check below.
  useEffect(() => {
    void getProfile().then(setProfile);
    void loadGeo().then(setGeo);
  }, []);

  // Re-assess with her current must-haves, free, whenever she changes one.
  const live = useMemo(
    () => (analysis && prefs && geo ? { ...analysis, ...assessJob(analysis.signals, prefs, master, analysis.jdText, { profile, geo }) } : analysis),
    [analysis, prefs, master, profile, geo],
  );

  // Keep the tracker row's stored verdict in step with the filters she just changed.
  useEffect(() => {
    if (!live || !app) return;
    void db.applications.update(app.id, { fitScore: live.score.score, fitBreakdown: JSON.stringify(toStoredBreakdown(live)) });
  }, [live, app]);

  const analyze = async (force = false) => {
    const link = url.trim();
    if (mode === "link" && !looksLikeUrl(link)) {
      setError({ message: "Enter the job posting's full link, starting with https://", needsKey: false });
      return;
    }
    if (mode === "paste" && !jdText.trim()) {
      setError({ message: "Paste the job description first.", needsKey: false });
      return;
    }
    setError(null);
    setPrevious(null);
    // Mark busy before the first await, so a quick second click can't start (and pay for) a second check.
    setStep("Checking...");
    try {
      // Same posting checked before? Say so before paying to read and score it again.
      if (!force && updateId === undefined && mode === "link") {
        const existing = await findExistingJob({ url: link });
        if (existing?.fitBreakdown) {
          setPrevious(existing);
          return;
        }
      }
      const [provider, current, masterText, me] = await Promise.all([getProvider(), getPreferences(), getMasterProfile(), getProfile()]);
      setMaster(masterText);
      setProfile(me);
      // Two visible steps for a link, so a slow page read doesn't look like a hang.
      let text = jdText;
      if (mode === "link") {
        setStep("Reading the job posting...");
        text = await readJobPosting(provider, link);
      }
      setStep("Scoring the job...");
      const a = await analyzeJob(provider, { url: link, jdText: text }, prefs ?? current, masterText, todayISO(), me);
      setStep("Saving it...");
      setApp(await saveAnalyzedJob(a, updateId));
      setAnalysis(a);
    } catch (e) {
      const needsKey = e instanceof AIError && e.kind === "no_key";
      setError({ message: e instanceof Error ? e.message : String(e), needsKey });
      // A page that can't be read automatically: switch to pasting, keeping the link.
      if (e instanceof AIError && e.kind === "fetch_failed") setMode("paste");
    } finally {
      setStep(null);
    }
  };

  /**
   * Save only a triage change, on top of the stored row: the row may have changed since this
   * dialog loaded it (tailoring a resume links the resume and moves the job into the table).
   */
  const persist = async (next: Application & { id: number }) => {
    if (next.triage) await db.applications.update(next.id, { triage: next.triage, updatedAt: Date.now() });
    else await db.applications.update(next.id, { triage: undefined, updatedAt: Date.now() });
    const fresh = await db.applications.get(next.id);
    return { ...(fresh ?? next), id: next.id };
  };

  const autoStarted = useRef(false);
  useEffect(() => {
    if (autoAnalyze && initialUrl && !autoStarted.current) {
      autoStarted.current = true;
      void analyze();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (live && app) {
    return (
      <Modal title={`${live.signals.role || "Job"}${live.signals.company ? ` at ${live.signals.company}` : ""}`} onClose={onClose}>
        <div className="grid gap-5">
          {app.checkedBefore ? (
            <Notice kind="info">
              You checked this position before, on {new Date(app.checkedBefore).toLocaleDateString(undefined, { month: "short", day: "numeric" })}. It&apos;s
              updated with this check instead of added twice.
            </Notice>
          ) : app.triage === "checked" ? (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-paper px-5 py-4 text-sm">
              <p className="max-w-md text-muted">
                Saved under <span className="font-medium text-ink">Checked jobs</span>. It joins your applications when you add it, tailor a
                resume for it, or apply.
              </p>
              <div className="flex flex-wrap gap-2">
                <Button onClick={async () => setApp({ ...app, ...(await persist(trackJob(app))) })}>Add to applications</Button>
                <Button variant="secondary" onClick={async () => setApp({ ...app, ...(await persist(skipJob(app))) })}>
                  Not applying
                </Button>
              </div>
            </div>
          ) : app.triage === "skipped" ? (
            <Notice kind="info">You marked this job as not applying. It stays under Checked jobs.</Notice>
          ) : (
            <Notice kind="ok">Updated in your applications.</Notice>
          )}
          <ScoreCard result={toStoredBreakdown(live)} />
          <MustHavesPanel onChange={setPrefs} />
          <div>
            <h3 className="mb-2 font-semibold tracking-tight">Tailored resume</h3>
            <TailorPanel
              application={app}
              autoStart={false}
              // Tailoring links the resume and puts the job in the applications table (in the DB);
              // keep this dialog's copy in step so its buttons don't write stale data back.
              onSaved={(id) => setApp((a) => (a ? { ...a, tailoredResumeId: id, triage: undefined, tailorDraft: undefined } : a))}
              notStartedReason={
                live.decision.canApply
                  ? "Tailors your resume to this job's keywords and skills, using only what's in your experience."
                  : "This job fails one of your must-haves. You can still tailor a resume if you want to apply anyway."
              }
            />
          </div>
          <div className="flex justify-end">
            <Button variant="secondary" onClick={onClose}>
              Done
            </Button>
          </div>
        </div>
      </Modal>
    );
  }

  return (
    <Modal title={initialMode === "paste" && initialUrl ? "Paste the job description" : "Add a job"} onClose={onClose}>
      <div className="mb-5 inline-flex rounded-full bg-black/[0.05] p-1 text-sm">
        {(["link", "paste"] as Mode[]).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setMode(m)}
            aria-pressed={mode === m}
            className={`rounded-full px-4 py-1.5 font-medium transition ${mode === m ? "bg-white text-ink shadow-soft" : "text-muted hover:text-ink"}`}
          >
            {m === "link" ? "From a link" : "Paste the description"}
          </button>
        ))}
      </div>

      <div className="grid gap-4">
        <Field label={mode === "link" ? "Job posting link" : "Job posting link (optional)"} value={url} onChange={setUrl} placeholder="https://..." />
        {mode === "paste" && <TextArea label="Job description" value={jdText} onChange={setJdText} rows={10} />}
        {mode === "link" && (
          <p className="text-xs leading-relaxed text-muted">
            Works for most company career pages, Greenhouse and Lever. Pages built with JavaScript (Workday, Ashby, Apple, LinkedIn)
            can&apos;t be read automatically; paste those instead. Reading and scoring costs about 1 to 2¢.
          </p>
        )}
      </div>

      <div className="mt-4">
        <MustHavesPanel onChange={setPrefs} />
      </div>

      {previous && <AlreadyChecked app={previous} onOpen={onOpenExisting} onCheckAgain={() => analyze(true)} />}

      {step && <Spinner label={step} />}
      {error && (
        <Notice kind="error">
          {error.message}
          {error.needsKey && (
            <>
              {" "}
              <Link href="/settings" className="underline">
                Go to Settings
              </Link>
              .
            </>
          )}
        </Notice>
      )}

      <div className="mt-5 flex justify-end gap-3">
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button onClick={() => analyze()} disabled={step !== null}>
          {step ? "Working..." : "Analyze"}
        </Button>
      </div>
    </Modal>
  );
}
