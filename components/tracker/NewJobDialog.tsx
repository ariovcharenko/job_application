"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { getProvider } from "@/lib/ai";
import { AIError } from "@/lib/ai/provider";
import { db, getMasterProfile, getPreferences, getProfile, getSettings } from "@/lib/db";
import { candidateFacts } from "@/lib/eligibility/candidate";
import { interviewFocusOf, runEarlyRead, skipOffer, type EarlyRead } from "@/lib/intake/earlyRead";
import { startParallelCheck, type ParallelCheck } from "@/lib/intake/parallelCheck";
import { checkedInLabel, createCheckTimer, timingBreakdown, type CheckTimer, type CheckTiming } from "@/lib/intake/timing";
import { loadGeo, type GeoIndex } from "@/lib/geo/index";
import { analyzeJob, assessJob, looksLikeUrl, readJobPosting, toStoredBreakdown, type JobAnalysis } from "@/lib/intake/analyze";
import { findExistingJob } from "@/lib/intake/dedupe";
import { getPairingToken } from "@/lib/extension/session";
import { planLink } from "@/lib/intake/sources";
import { saveAnalyzedJob, saveEarlySkip, type SavedJob } from "@/lib/intake/save";
import { headlineOf } from "@/lib/intake/stored";
import { postedAge, postedLabel } from "@/lib/tracker/postedAge";
import { saveApplication } from "@/lib/tracker/repo";
import { skipJob, trackJob } from "@/lib/tracker/triage";
import { todayISO } from "@/lib/tracker/stage";
import type { Application, Preferences, Profile } from "@/lib/types";
import { Button, Field, Modal, Notice, Spinner, TextArea } from "@/components/ui";
import { useCloseGuard } from "../tailor/useCloseGuard";
import MustHavesPanel from "./MustHavesPanel";
import ScoreCard from "./ScoreCard";
import BulkLinksPanel from "./BulkLinksPanel";
import EarlyReadPills from "./EarlyReadPills";
import QuickResultCard from "./QuickResult";
import { quickResult } from "@/lib/intake/quick";

// The tailoring screen (and the .docx writer behind it) loads only when she tailors.
const TailorPanel = dynamic(() => import("../tailor/TailorPanel"), { ssr: false });

type Mode = "link" | "bulk" | "paste";

const MODE_LABELS: Record<Mode, string> = { link: "Link", bulk: "Several links", paste: "Paste text" };

/** Shown when she enters a link she already checked, before anything is spent on it again. */
function AlreadyChecked({
  app,
  onOpen,
  onCheckAgain,
  againLabel = "Check it again (1 to 2¢)",
}: {
  app: Application & { id: number };
  onOpen?: (app: Application & { id: number }) => void;
  onCheckAgain: () => void;
  /** The second button: re-check (before spending) or keep this new check (after it was paid for). */
  againLabel?: string;
}) {
  const verdict = headlineOf(app)?.pill ?? null;
  const when = new Date(app.updatedAt || app.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  const where = app.triage === "skipped" ? "marked as not applying" : app.triage === "checked" ? "under Checked jobs" : `in your applications (${app.stage})`;
  return (
    <div className="mt-4 rounded-2xl bg-accent-soft/50 p-5" role="status">
      <p className="font-semibold tracking-display">Already checked</p>
      <p className="mt-1 text-sm text-muted">
        {app.role || "This job"}
        {app.company ? ` at ${app.company}` : ""}, on {when}
        {verdict ? `: ${verdict}` : ""}. It&apos;s {where}.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        {onOpen && <Button onClick={() => onOpen(app)}>Open it</Button>}
        <Button variant="secondary" onClick={onCheckAgain}>
          {againLabel}
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
  const guard = useCloseGuard(onClose);
  const [mode, setMode] = useState<Mode>(initialMode ?? (initialJdText ? "paste" : "link"));
  const [url, setUrl] = useState(initialUrl);
  const [jdText, setJdText] = useState(initialJdText);
  const [step, setStep] = useState<string | null>(null);
  const [error, setError] = useState<{ message: string; needsKey: boolean; extensionTip?: boolean } | null>(null);
  const [analysis, setAnalysis] = useState<JobAnalysis | null>(null);
  const [app, setApp] = useState<SavedJob | null>(null);
  // A link she already checked: shown before spending anything on it again.
  const [previous, setPrevious] = useState<(Application & { id: number }) | null>(null);
  // A pasted description (no link) that turned out to be a position she already checked: the new
  // check is held here until she opens the old one or chooses to keep this one.
  const [duplicate, setDuplicate] = useState<{ existing: Application & { id: number }; analysis: JobAnalysis } | null>(null);
  const [prefs, setPrefs] = useState<Preferences | null>(null);
  const [master, setMaster] = useState("");
  const [profile, setProfile] = useState<Profile | null>(null);
  const [geo, setGeo] = useState<GeoIndex | null>(null);
  const [moving, setMoving] = useState(false);
  // The optional Jev early read, shown while Claude's check runs. Display only: never saved as a verdict.
  const [early, setEarly] = useState<EarlyRead | null>(null);
  // The posting text, once in hand, for the instant code-only quick result.
  const [quickText, setQuickText] = useState("");
  // An early read that says this job is not a fit: held until she picks Skip or Check anyway.
  // Claude's check is already running while this is shown: Skip stops it, Check anyway lets it finish.
  const [skipAsk, setSkipAsk] = useState<{ text: string; link: string; reason: string } | null>(null);
  const [skipping, setSkipping] = useState(false);
  // The check in flight (so Skip can abort it) and how long each step took (shown as "Checked in 4.2s").
  const runRef = useRef<ParallelCheck<void> | null>(null);
  const [timing, setTiming] = useState<CheckTiming | null>(null);
  // A link from "Several links" that needs its text pasted, opened in its own dialog on top.
  const [pasteFor, setPasteFor] = useState<string | null>(null);

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

  // Instant, code-only result while Claude's check runs (uses the early read when Jev has answered).
  const quick = useMemo(
    () => (quickText && prefs && profile ? quickResult({ jdText: quickText, early, mustHaves: prefs.mustHaves, candidate: candidateFacts(profile), master, prefs }) : null),
    [quickText, early, prefs, profile, master],
  );

  // Keep the tracker row's stored verdict in step with the filters she just changed.
  useEffect(() => {
    if (!live || !app) return;
    void db.applications.update(app.id, { fitScore: live.score.score, fitBreakdown: JSON.stringify(toStoredBreakdown(live)) });
  }, [live, app]);

  /** Whether the Chrome extension is paired, so an error can point to its "Score this job" button. */
  const extensionPaired = () => {
    try {
      return !!getPairingToken();
    } catch {
      return false;
    }
  };

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
    // A link nothing can read (LinkedIn, Workday, ...): say so now, before a key or a cent is involved.
    if (mode === "link") {
      const plan = planLink(link);
      if (plan.kind === "paste") {
        setError({ message: plan.message, needsKey: false, extensionTip: extensionPaired() });
        setMode("paste");
        return;
      }
    }
    setError(null);
    setPrevious(null);
    setDuplicate(null);
    setSkipAsk(null);
    setEarly(null);
    setTiming(null);
    setQuickText("");
    const timer = createCheckTimer();
    // Mark busy before the first await, so a quick second click can't start (and pay for) a second check.
    setStep("Checking...");
    try {
      // Same posting checked before? Say so before paying to read and score it again. A pasted
      // description with its link is recognized by the link too.
      if (!force && updateId === undefined && looksLikeUrl(link)) {
        const existing = await findExistingJob({ url: link });
        if (existing?.fitBreakdown) {
          setPrevious(existing);
          return;
        }
      }
      const [provider, current, settings, me] = await Promise.all([getProvider("check_job"), getPreferences(), getSettings(), getProfile()]);
      // Two visible steps for a link, so a slow page read doesn't look like a hang.
      let text = jdText;
      if (mode === "link") {
        setStep("Reading the job posting...");
        timer.start("read");
        text = await readJobPosting(provider, link, { onStep: setStep });
        timer.end("read");
      }
      // The moment the text is in hand, Claude's check and the optional Jev early read both
      // start, side by side. Claude never waits for Jev (Jev never throws; null with no key).
      // The quick estimate (code only) shows from this point too.
      setQuickText(text);
      void getMasterProfile().then(setMaster);
      timer.start("jev");
      const earlyP = runEarlyRead(settings.jevKey, text).then((r) => {
        timer.end("jev");
        return r;
      });
      void earlyP.then((r) => r && setEarly(r));
      const mustHaves = (prefs ?? current).mustHaves;
      const candidate = candidateFacts(me);
      const run = startParallelCheck<void>({
        check: (signal) => finishCheck(text, link, earlyP, force, signal, timer),
        early: earlyP,
        offerFor: (r) => skipOffer(r, mustHaves, candidate),
        // Claude is still running: offer the skip. Nothing is skipped without her click.
        onOffer: (offer) => setSkipAsk({ text, link, reason: offer.reason }),
      });
      runRef.current = run;
      await run.result;
    } catch (e) {
      // She chose Skip: the aborted check is not an error.
      if (e instanceof AIError && e.kind === "cancelled") return;
      const needsKey = e instanceof AIError && e.kind === "no_key";
      const unreadable = e instanceof AIError && e.kind === "fetch_failed";
      setError({ message: e instanceof Error ? e.message : String(e), needsKey, extensionTip: unreadable && extensionPaired() });
      // A page that can't be read automatically: switch to pasting, keeping the link.
      if (unreadable) setMode("paste");
    } finally {
      runRef.current = null;
      setSkipAsk(null);
      setStep(null);
    }
  };

  /** Claude's check and the save, from the posting text on. The stored verdict comes only from this. */
  const finishCheck = async (text: string, link: string, earlyP: Promise<EarlyRead | null>, force: boolean, signal: AbortSignal, timer: CheckTimer) => {
    const cancelled = () => new AIError("cancelled", "Skipped.");
    const [provider, current, masterText, me] = await Promise.all([getProvider("check_job"), getPreferences(), getMasterProfile(), getProfile()]);
    setMaster(masterText);
    setProfile(me);
    setStep("Scoring the job...");
    timer.start("claude");
    const a = await analyzeJob(provider, { url: link, jdText: text }, prefs ?? current, masterText, todayISO(), me, { signal });
    timer.end("claude");
    // Interview focus is the one thing kept from the early read, and only when Jev was confident.
    // (Jev has its own short timeout, so this wait is bounded and usually already over.)
    const focus = interviewFocusOf(await earlyP);
    if (focus) a.interviewFocus = focus;
    if (signal.aborted) throw cancelled();
    // Pasted with no link: company and role are only known now. If she already checked this
    // position, ask before saving over it (saving would update that row, not add a second one).
    if (!force && updateId === undefined && !looksLikeUrl(link)) {
      const existing = await findExistingJob({ company: a.signals.company, role: a.signals.role });
      if (existing?.fitBreakdown) {
        setDuplicate({ existing, analysis: a });
        return;
      }
    }
    if (signal.aborted) throw cancelled();
    setStep("Saving it...");
    timer.start("save");
    const saved = await saveAnalyzedJob(a, updateId);
    timer.end("save");
    setApp(saved);
    setAnalysis(a);
    setTiming(timer.snapshot());
  };

  /** "Check anyway" on the early-read offer: Claude's check is already running, so just close the offer. */
  const checkAnyway = () => setSkipAsk(null);

  /** "Skip" on the early-read offer: stop Claude's call and remember the job as not applying. */
  const skipForNow = async () => {
    if (!skipAsk || skipping) return;
    const { text, link, reason } = skipAsk;
    setSkipping(true);
    runRef.current?.abort();
    try {
      await saveEarlySkip({ url: link, jdText: text, reason });
      setSkipAsk(null);
      onClose();
    } catch (e) {
      setError({ message: e instanceof Error ? e.message : String(e), needsKey: false });
    } finally {
      setSkipping(false);
    }
  };

  /** She chose to keep the new check of a position she had checked before: save it (updates that row). */
  const keepDuplicate = async () => {
    if (!duplicate || step) return;
    const { analysis: a } = duplicate;
    setStep("Saving it...");
    try {
      setApp(await saveAnalyzedJob(a, updateId));
      setAnalysis(a);
      setDuplicate(null);
    } catch (e) {
      setError({ message: e instanceof Error ? e.message : String(e), needsKey: false });
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

  /** "Add to applications" / "Not applying" from the result view, guarded against double clicks. */
  const move = async (next: Application & { id: number }) => {
    if (!app || moving) return;
    setMoving(true);
    try {
      const stored = await persist(next);
      setApp({ ...app, ...stored });
    } finally {
      setMoving(false);
    }
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
      <>
      <Modal title={`${live.signals.role || "Job"}${live.signals.company ? ` at ${live.signals.company}` : ""}`} onClose={guard.requestClose}>
        <div className="grid gap-5">
          {app.checkedBefore ? (
            <Notice kind="info">
              Checked before, on {new Date(app.checkedBefore).toLocaleDateString(undefined, { month: "short", day: "numeric" })}. Updated, not added twice.
            </Notice>
          ) : app.triage === "checked" ? (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-paper px-5 py-4 text-sm">
              <p className="text-muted">
                Saved under <span className="font-medium text-ink">Checked jobs</span>.
              </p>
              <div className="flex flex-wrap gap-2">
                <Button disabled={moving} onClick={() => move(trackJob(app))}>
                  Add to applications
                </Button>
                <Button variant="secondary" disabled={moving} onClick={() => move(skipJob(app))}>
                  Not applying
                </Button>
              </div>
            </div>
          ) : app.triage === "skipped" ? (
            <div role="status">
              <Notice kind="info">
                Marked as not applying.{" "}
                <button type="button" disabled={moving} onClick={() => move({ ...app, triage: "checked" })} className="font-medium text-accent hover:underline">
                  Undo
                </button>
              </Notice>
            </div>
          ) : (
            <div role="status">
              <Notice kind="ok">In your applications.</Notice>
            </div>
          )}
          <ScoreCard result={toStoredBreakdown(live)} posted={postedLabel(postedAge(live.signals, app.createdAt, Date.now()))} />
          {timing && (
            <p className="-mt-2 text-xs text-muted" title={timingBreakdown(timing)}>
              {checkedInLabel(timing)}
            </p>
          )}
          <MustHavesPanel onChange={setPrefs} />
          <div>
            <h3 className="mb-2 font-semibold tracking-tight">Tailored resume</h3>
            <TailorPanel
              application={app}
              autoStart={false}
              onBusyChange={guard.setBusy}
              // Tailoring links the resume and puts the job in the applications table (in the DB);
              // keep this dialog's copy in step so its buttons don't write stale data back.
              onSaved={(id) => setApp((a) => (a ? { ...a, tailoredResumeId: id, triage: undefined, tailorDraft: undefined } : a))}
              notStartedReason={
                live.decision.canApply
                  ? "Written only from your experience."
                  : "This job fails a must-have. You can still tailor a resume for it."
              }
            />
          </div>
          <div className="flex justify-end border-t border-black/[0.06] pt-5">
            <Button variant="secondary" onClick={guard.requestClose}>
              Done
            </Button>
          </div>
        </div>
      </Modal>
      {guard.confirm}
      </>
    );
  }

  return (
    <Modal title={initialMode === "paste" && initialUrl ? "Paste the job description" : "Add a job"} onClose={onClose}>
      <div className="mb-5 inline-flex rounded-full bg-black/[0.05] p-1 text-sm" role="group" aria-label="How to add the job">
        {((updateId === undefined ? ["link", "bulk", "paste"] : ["link", "paste"]) as Mode[]).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setMode(m)}
            aria-pressed={mode === m}
            className={`rounded-full px-4 py-1.5 font-medium transition ${mode === m ? "bg-white text-ink shadow-soft" : "text-muted hover:text-ink"}`}
          >
            {MODE_LABELS[m]}
          </button>
        ))}
      </div>

      {mode === "bulk" ? (
        <>
          <BulkLinksPanel onClose={onClose} onPaste={setPasteFor} />
          {pasteFor && <NewJobDialog initialMode="paste" initialUrl={pasteFor} onClose={() => setPasteFor(null)} />}
        </>
      ) : (
        <>
          <div className="grid gap-4">
            <Field label={mode === "link" ? "Job posting link" : "Job posting link (optional)"} value={url} onChange={setUrl} placeholder="https://..." />
            {mode === "paste" && <TextArea label="Job description" value={jdText} onChange={setJdText} rows={10} />}
            {mode === "link" && (
              <p className="text-xs leading-relaxed text-muted">Greenhouse, Lever, Ashby and SmartRecruiters links are read for free. LinkedIn, Indeed and Workday pages can&apos;t be read: paste their text instead.</p>
            )}
          </div>

          <div className="mt-4">
            <MustHavesPanel onChange={setPrefs} />
          </div>

          {previous && <AlreadyChecked app={previous} onOpen={onOpenExisting} onCheckAgain={() => analyze(true)} />}
          {duplicate && (
            <AlreadyChecked app={duplicate.existing} onOpen={onOpenExisting} onCheckAgain={keepDuplicate} againLabel="Update it with this check" />
          )}

          {skipAsk && (
            <div className="mt-4 rounded-2xl bg-paper p-5" role="status">
              <p className="font-semibold tracking-display">Early read: this looks like Not a fit for you ({skipAsk.reason}).</p>
              <p className="mt-1 text-sm text-muted">Skip the full check? Nothing is skipped unless you choose Skip.</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button onClick={skipForNow} disabled={skipping}>
                  Skip
                </Button>
                <Button variant="secondary" onClick={checkAnyway} disabled={skipping}>
                  Check anyway
                </Button>
              </div>
            </div>
          )}
          {quick && !skipAsk && step && <QuickResultCard result={quick} />}
          {early && !quick && !skipAsk && step && prefs && <EarlyReadPills read={early} mustHaves={prefs.mustHaves} />}
          <div aria-live="polite">{step && <Spinner label={step} />}</div>
          {error && (
            <Notice kind="error">
              {error.message}
              {error.extensionTip && <> Or open the posting and press &quot;Score this job&quot; in the Chrome extension.</>}
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

          <div className="mt-5 flex flex-wrap items-center justify-end gap-3 border-t border-black/[0.06] pt-5">
            <span className="mr-auto text-[13px] text-muted">About 1 to 2¢</span>
            <Button variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button onClick={() => analyze()} disabled={step !== null}>
              {step ? "Working..." : "Analyze"}
            </Button>
          </div>
        </>
      )}
    </Modal>
  );
}
