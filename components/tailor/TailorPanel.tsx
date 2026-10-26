"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { canFallBackToClaude, providerFor, type WriterFallback } from "@/lib/ai/route";
import type { ProviderId } from "@/lib/ai/provider";
import { getMasterProfile, getProfile, getSettings, saveMasterProfile } from "@/lib/db";
import { checkWording } from "@/lib/resume/engine/honesty";
import { saveJobWording } from "@/lib/resume/engine/save";
import { buildHeader, type ResumeHeader } from "@/lib/resume/engine";
import { fillOffer } from "@/lib/resume/engine/fillable";
import { withOpenFlags } from "@/lib/resume/engine/checks";
import { addedSkillMessage, POLISH_FAILED_NOTE, polishFailed, updateDoneMessage } from "@/lib/resume/engine/runNotes";
import { pageFill } from "@/lib/resume/engine/fit";
import { PAGE_CSS, renderResumeHtml } from "@/lib/resume/engine/html";
import { diffDocs } from "@/lib/resume/engine/changes";
import { exportResume, getJobResume, saveJobReview, storeJobResume, type ExportResult, type PreviousVersion } from "@/lib/resume/engine/save";
import { docFingerprint, restoreReview, type StoredReview } from "@/lib/resume/engine/reviewState";
import { saveRoleFact } from "@/lib/resume/master/saveFact";
import { persistVersion, tailorAndSave } from "@/lib/resume/engine/persist";
import { placeOptions, placeTarget } from "@/lib/resume/engine/places";
import { historyAfterStartOver } from "@/lib/resume/engine/history";
import { AIError } from "@/lib/ai/provider";
import { describeAIError } from "@/lib/ai/errors";
import { createDebouncedSave } from "@/lib/resume/engine/autosave";
import { fitResume, toPoolTarget, toVisibleSpot } from "@/lib/resume/engine/trim";
import { verifyResume } from "@/lib/resume/engine/verify";
import { assertUsable, type TailorProgress as Progress } from "@/lib/resume/engine/pipeline";
import TailorProgress, { SlowNote } from "./TailorProgress";
import { explainTailoring } from "@/lib/resume/engine/tailored";
import { addSkill, describeTarget, removeSpot, removeTarget, spotOn, targetFromElement, type Target } from "@/lib/resume/engine/edit";
import { editTarget, textOfTarget } from "@/lib/resume/engine/editText";
import { popoverPlacement, PREVIEW_SCALE, previewScale } from "@/lib/resume/engine/preview";
import type { ResumeDoc } from "@/lib/resume/engine/schema";
import { cleanTitle, entriesNotOnPage } from "@/lib/resume/master/experiences";
import { appendSkillToMaster, appendUsageNote, hasSkill, parseSkillInventory, type RoleKey } from "@/lib/resume/master/skills";
import { carryApprovals, fillComment, placementComment, reviseResume, type ResumeComment } from "@/lib/resume/engine/revise";
import { applyApprovals, normalizeFlagMessage, resumeText, validateResume, withWording, type Flag, type ValidationResult, type WordingHit } from "@/lib/resume/engine/validate";
import { jobFocusFor, jobSkills, skillCoverage, skillHits, skillReadiness } from "@/lib/resume/coverage";
import { tailoredFileName } from "@/lib/resume/fileName";
import type { Application } from "@/lib/types";
import { Button, ConfirmDialog, inputClass, Notice, Spinner } from "@/components/ui";
import AIErrorNotice from "@/components/resumes/AIErrorNotice";
import RecruiterReviewCard, { type ReadinessCounts } from "./RecruiterReviewCard";
import { answerComment, codeReviewItems, mergeReviewItems, planReviewItems, relocateTarget, reviewResume, type ReviewItem } from "@/lib/resume/engine/review";
import { isSoftSkill, normalizeSkill } from "@/lib/resume/master/skills";
import WriterFallbackNotice from "./WriterFallbackNotice";
import { useWriterLabel } from "./useResumeWriter";
import AskForChanges from "./AskForChanges";
import QualityCard from "./QualityCard";
import TailoredForCard from "./TailoredForCard";
import { lintResume } from "@/lib/resume/quality/lint";
import { issuesToComments, qualityScore } from "@/lib/resume/quality/summary";
import { readBreakdown } from "@/lib/intake/stored";

/** How long updates take, shown once a resume exists. */
const TIME_LINE = "Each update takes about 30 seconds. A recruiter review takes about 20 seconds.";

function PopoverAction({ label, hint, onClick, danger }: { label: string; hint: string; onClick: () => void; danger?: boolean }) {
  return (
    <button type="button" onClick={onClick} className="rounded-xl px-3 py-2 text-left transition hover:bg-paper">
      <span className={`block text-[13px] font-medium ${danger ? "text-bad" : "text-ink"}`}>{label}</span>
      <span className="block text-xs text-muted">{hint}</span>
    </button>
  );
}

function CheckIcon({ ok }: { ok: boolean }) {
  return ok ? (
    <svg viewBox="0 0 16 16" className="mt-0.5 h-4 w-4 shrink-0 text-good" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-label="Passed">
      <path d="m3.5 8.5 3 3 6-7" />
    </svg>
  ) : (
    <svg viewBox="0 0 16 16" className="mt-0.5 h-4 w-4 shrink-0 text-warn" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-label="Check this">
      <circle cx="8" cy="8" r="6" />
      <path d="M8 5v3.5M8 11h.01" />
    </svg>
  );
}

/** One flagged line: what's wrong, and Keep / Remove. */
function FlagRow({ flag, onKeep, onRemove, disabled }: { flag: Flag; onKeep: () => void; onRemove: () => void; disabled?: boolean }) {
  return (
    <li className="flex flex-wrap items-start justify-between gap-2 text-[13px]">
      <span className="min-w-0 flex-1">
        <span className={`mr-1.5 inline-block rounded-full px-2 py-0.5 text-[11px] font-medium ${flag.severity === "block" ? "bg-bad-soft text-bad" : "bg-white text-ink"}`}>
          {flag.severity === "block" ? "Left out" : "Look at"}
        </span>
        {flag.message}
        <span className="mt-0.5 block text-xs text-muted">
          {flag.kind === "wording"
            ? "Jev's check is only a hint. Keep it as is if it is accurate, or click the line to rewrite it."
            : flag.severity === "block"
              ? "Not in Your experience, so it is struck through and left out unless you keep it."
              : "This is in Your experience, but check that it says what you mean."}
        </span>
      </span>
      <span className="flex shrink-0 gap-1">
        <button type="button" disabled={disabled} onClick={onKeep} className="rounded-full bg-black/[0.05] px-2.5 py-0.5 text-xs font-medium hover:bg-accent-soft hover:text-accent-deep disabled:opacity-40">
          {flag.kind === "wording" ? "Keep as is" : "Keep"}
        </button>
        <button type="button" disabled={disabled} onClick={onRemove} className="rounded-full px-2.5 py-0.5 text-xs font-medium text-bad hover:bg-bad-soft disabled:opacity-40">
          Remove
        </button>
      </span>
    </li>
  );
}

/** A skill she placed in a role, waiting for the one call that writes it into that role's bullets. */
interface Placement {
  skill: string;
  how: string;
  role: RoleKey;
  label: string;
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

export default function TailorPanel({
  application,
  autoStart,
  notStartedReason,
  onSaved,
  onBusyChange,
}: {
  application: Application & { id: number };
  /** Generate immediately on mount (a strong match); otherwise wait for a click. */
  autoStart: boolean;
  /** Shown instead of starting automatically, e.g. "Not an Apply match". */
  notStartedReason?: string;
  /** Called with the tailored resume's id each time the current version is saved to this job. */
  onSaved?: (tailoredResumeId: number) => void;
  /** True while an AI call is running, so the dialog around it can ask before closing. */
  onBusyChange?: (busy: boolean) => void;
}) {
  const [master, setMasterState] = useState<string | null>(null);
  // The latest experience text, also for calls that start in the same click that changed it.
  const masterRef = useRef("");
  const setMaster = (m: string) => {
    masterRef.current = m;
    setMasterState(m);
  };
  const [header, setHeader] = useState<ResumeHeader | null>(null);
  const [fullName, setFullName] = useState("");
  const [phase, setPhase] = useState<"idle" | "generating" | "ready" | "saving" | "revising">("idle");
  // The first draft is on screen while the automatic polish runs (phase "revising" meanwhile).
  const [polishing, setPolishing] = useState(false);
  const [progress, setProgress] = useState<Progress | null>(null);
  // The page as it was before the last update, so what the update changed shows in yellow.
  const [changedFrom, setChangedFrom] = useState<ResumeDoc | null>(null);
  const [error, setError] = useState<string | null>(null);
  // An AI call that failed, shown with the link that fixes it (credit, key, rate limit...).
  const [aiError, setAiError] = useState<unknown>(null);
  // "Use Claude for this run": set when OpenAI is the resume writer but can't be used right now.
  // Lasts while this panel is open; the saved choice in Settings is unchanged.
  const [writerOverride, setWriterOverride] = useState<ProviderId | undefined>(undefined);
  // The AI action that last failed, so the OpenAI fallback can run it again.
  const retryRef = useRef<((override?: ProviderId) => void) | null>(null);
  const writerLabel = useWriterLabel(writerOverride);
  // Skills added to the Skills line from the review card in this session, to confirm them there.
  const [addedToSkills, setAddedToSkills] = useState<string[]>([]);
  const [result, setResult] = useState<ValidationResult | null>(null);
  // Flags she decided to keep: a blocked line she confirmed, or a note she looked at.
  const [approved, setApproved] = useState<Set<string>>(new Set());
  const [saved, setSaved] = useState<(ExportResult & { fileName: string }) | null>(null);
  // Every version is saved to this job automatically; this tracks that, not the download.
  const [storedId, setStoredId] = useState<number | null>(null);
  const [storeState, setStoreState] = useState<"idle" | "saving" | "saved">("idle");
  const loadedFromStore = useRef(false);
  const [saver] = useState(() => createDebouncedSave(600));
  const started = useRef(false);
  const [placements, setPlacements] = useState<Placement[]>([]);
  // Recruiter review: the model's items (code decided their actions), what she queued or ignored,
  // and the code-counted readiness when this draft or the last review started.
  const [reviewItems, setReviewItems] = useState<ReviewItem[]>([]);
  const [reviewSummary, setReviewSummary] = useState<string | null>(null);
  const [reviewing, setReviewing] = useState(false);
  const [queued, setQueued] = useState<Map<string, { comment: ResumeComment; quote?: string }>>(new Map());
  const [ignored, setIgnored] = useState<Set<string>>(new Set());
  const [doneIds, setDoneIds] = useState<Set<string>>(new Set());
  const [baseline, setBaseline] = useState<ReadinessCounts | null>(null);
  // Fingerprint of the page the last review was made for (stored with the review, reviewState.ts).
  const [reviewedFor, setReviewedFor] = useState<string | null>(null);
  // The review saved with this job, waiting for the page to be measured before it's shown again.
  const pendingReview = useRef<StoredReview | null>(null);
  // False until the saved review (if any) is back on screen, so an empty start never overwrites it.
  const reviewHydrated = useRef(false);
  const [reviewSaver] = useState(() => createDebouncedSave(600));
  const [selection, setSelection] = useState<{
    quote: string;
    x: number;
    y: number;
    width: number;
    maxHeight: number;
    target: Target | null;
  } | null>(null);
  const [scale, setScale] = useState(PREVIEW_SCALE);
  const scaleRef = useRef(PREVIEW_SCALE);
  const [popoverMode, setPopoverMode] = useState<"actions" | "swap" | "custom" | "edit">("actions");
  const [editText, setEditText] = useState("");
  const popoverRef = useRef<HTMLDivElement>(null);
  const openedFrom = useRef<HTMLElement | null>(null);
  const [note, setNote] = useState("");
  const [changes, setChanges] = useState<string[]>([]);
  // "Written with Claude: OpenAI was out of credit." when the last call moved to Claude on its own.
  const [fallbackNote, setFallbackNote] = useState<string | null>(null);
  const writerOpts = (override: ProviderId | undefined) => ({ override, onFallback: (f: WriterFallback) => setFallbackNote(f.message) });
  // Undo stack. Each entry also keeps which review items were done at that point, so undoing one
  // update doesn't bring back items applied by earlier updates.
  const [history, setHistory] = useState<{ result: ValidationResult; approved: Set<string>; doneIds: Set<string> }[]>([]);
  // A short confirmation near the preview ("Added Docker to your Skills line."), faded after a few seconds.
  const [flash, setFlash] = useState<{ text: string; fading: boolean } | null>(null);
  const flashTimers = useRef<number[]>([]);
  const showFlash = (text: string) => {
    flashTimers.current.forEach((t) => window.clearTimeout(t));
    setFlash({ text, fading: false });
    flashTimers.current = [
      window.setTimeout(() => setFlash((f) => (f ? { ...f, fading: true } : f)), 3500),
      window.setTimeout(() => setFlash(null), 4200),
    ];
  };
  useEffect(() => () => flashTimers.current.forEach((t) => window.clearTimeout(t)), []);
  // The automatic polish failed and the first draft was kept.
  const [polishNote, setPolishNote] = useState<string | null>(null);
  const skippedPolish = useRef(false);
  // Set when an AI update finished, so the next render can say how many spots are marked.
  const announceMarks = useRef(false);
  const alertRef = useRef<HTMLDivElement>(null);
  // The running AI call, so "Cancel" can stop it.
  const abortRef = useRef<AbortController | null>(null);
  // Optional Jev wording check (honesty.ts): runs beside the other steps, never blocks the preview.
  const jevKeyRef = useRef("");
  const wordingRef = useRef<WordingHit[]>([]);
  const wordingAbort = useRef<AbortController | null>(null);
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      wordingAbort.current?.abort();
    };
  }, []);
  const vopts = (extra: { addJobSkills?: boolean } = {}) => ({ ...checkOpts, wording: wordingRef.current, ...extra });
  /** Asks Jev about the bullets of `doc`; the notes appear when it answers. No key or any error: nothing. */
  const runWording = (doc: ResumeDoc, m: string) => {
    wordingAbort.current?.abort();
    const key = jevKeyRef.current;
    if (!key.trim()) return;
    const c = new AbortController();
    wordingAbort.current = c;
    void checkWording(key, doc, m, { signal: c.signal }).then((hits) => {
      if (c.signal.aborted || !mountedRef.current) return;
      wordingRef.current = hits;
      setResult((cur) => (cur ? withWording(cur, hits) : cur));
      void saveJobWording(application.id, hits).catch(() => {});
    });
  };
  const [confirmStart, setConfirmStart] = useState(false);
  // An error or notice appears at the top of the panel; bring it into view if she is scrolled away.
  useEffect(() => {
    if (error || aiError !== null) alertRef.current?.scrollIntoView?.({ block: "center", behavior: "smooth" });
  }, [error, aiError]);
  // Earlier saved versions of this job's resume (save.ts keeps the last 3), newest first.
  const [previousVersions, setPreviousVersions] = useState<PreviousVersion[]>([]);
  const previewBox = useRef<HTMLDivElement>(null);
  const pageRef = useRef<HTMLDivElement>(null);

  // The job's skills and what the job is about (must-haves, domains, responsibilities, role family).
  const { fitBreakdown, jdText, role } = application;
  const skillsForJob = useMemo(() => (master ? jobSkills({ fitBreakdown, jdText }, master) : []), [fitBreakdown, jdText, master]);
  const focus = useMemo(() => (master ? jobFocusFor({ fitBreakdown, jdText, role }, master) : null), [fitBreakdown, jdText, role, master]);
  const checkOpts = useMemo(() => ({ jobSkills: skillsForJob, focus: focus ?? undefined }), [skillsForJob, focus]);
  const fitOpts = useMemo(
    () => (focus ? { focus } : { relevance: (text: string) => skillHits(skillsForJob, text) }),
    [focus, skillsForJob],
  );
  const requiredSkills = useMemo(() => {
    const s = readBreakdown({ fitBreakdown })?.skills;
    return s ? [...s.required.have, ...s.required.gap] : [];
  }, [fitBreakdown]);

  useEffect(() => {
    Promise.all([getMasterProfile(), getProfile(), getJobResume(application.id), getSettings()]).then(([m, p, existing, settings]) => {
      jevKeyRef.current = settings.jevKey ?? "";
      if (existing?.stored.wording) wordingRef.current = existing.stored.wording;
      // Reopen the resume already saved for this job, with her decisions, instead of an empty panel.
      if (existing && m.trim()) {
        const reopened = validateResume(existing.stored.doc, m, { jobSkills: jobSkills(application, m), focus: jobFocusFor(application, m), wording: wordingRef.current });
        // Older saves stored ticks with the previous "master profile" wording.
        const ticked = new Set(existing.stored.approved.map(normalizeFlagMessage));
        loadedFromStore.current = true;
        setResult(reopened);
        setApproved(new Set(reopened.flags.filter((f) => ticked.has(f.message)).map((f) => f.id)));
        setStoredId(existing.id);
        setStoreState("saved");
        setPreviousVersions(existing.stored.previous ?? []);
        pendingReview.current = existing.stored.review ?? null;
        setPhase("ready");
      }
      if (!pendingReview.current) reviewHydrated.current = true;
      setMaster(m);
      setHeader(buildHeader(p));
      setFullName(p.fullName);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [application.id]);

  /** "Tailor resume". Missing skills are asked about afterwards, in the recruiter review. */
  const start = () => void generate();

  /** A new AbortController for the call about to run (her Cancel stops it). */
  const newSignal = () => {
    abortRef.current?.abort();
    const c = new AbortController();
    abortRef.current = c;
    return c.signal;
  };
  const cancelRun = () => {
    if (polishing) skippedPolish.current = true;
    abortRef.current?.abort();
  };
  const isCancel = (e: unknown) => e instanceof AIError && e.kind === "cancelled";

  /**
   * Saves a version to this job right where the AI call returns, not in an effect, so closing the
   * dialog mid-run can't lose a result she paid for. The effect below saves her later edits.
   */
  const persistNow = async (r: ValidationResult, kept: Set<string>, m: string) => {
    if (!header) return;
    try {
      const id = await persistVersion(application.id, { header, result: r, approved: kept, measure: (d) => pageFill(header, d), fitOpts, jobSkills: skillsForJob, master: m });
      setStoredId(id);
      setStoreState("saved");
      onSaved?.(id);
      void refreshVersions();
    } catch (e) {
      setError(`Couldn't save this resume to the job: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const refreshVersions = async () => {
    const row = await getJobResume(application.id);
    setPreviousVersions(row?.stored.previous ?? []);
  };

  /** Forget the last review: a new draft gets a fresh one. */
  const resetReview = () => {
    setAddedToSkills([]);
    setReviewItems([]);
    setReviewSummary(null);
    setQueued(new Map());
    setIgnored(new Set());
    setDoneIds(new Set());
    setBaseline(null);
    setReviewedFor(null);
  };

  /** One tailoring run. */
  const generate = async (override: ProviderId | undefined = writerOverride) => {
    const m = masterRef.current;
    if (!m.trim() || !header) return;
    setError(null);
    setAiError(null);
    setSaved(null);
    setProgress(null);
    setPhase("generating");
    setFallbackNote(null);
    setPolishNote(null);
    skippedPolish.current = false;
    const signal = newSignal();
    try {
      // One call writes the final page to a plan computed from the real layout; a second, short one
      // only when the measured page ends short or code found a writing fix (pipeline.ts).
      // Saved to the job inside the run itself, so closing the dialog now still keeps it.
      const { out, id, saveError } = await tailorAndSave(
        {
          provider: await providerFor("write_resume", writerOpts(override)),
          polishProvider: await providerFor("polish_resume", writerOpts(override)),
          master: m,
          company: application.company,
          jdText: application.jdText,
          jobSkills: skillsForJob,
          requiredSkills,
          focus: focus ?? undefined,
          measure: (d) => pageFill(header, d),
          onProgress: setProgress,
          // Show the checked draft at once; the polish pass finishes behind a small banner.
          onDraft: (draft) => {
            setResult(draft);
            setApproved(new Set());
            setPolishing(true);
            setPhase("revising");
          },
          signal,
        },
        { applicationId: application.id, header, fitOpts },
      );
      if (id !== null) {
        setStoredId(id);
        setStoreState("saved");
        onSaved?.(id);
        void refreshVersions();
      } else if (saveError) setError(`Couldn't save this resume to the job: ${saveError}`);
      // Tailor again keeps the version she had one Undo away.
      setHistory((h) => historyAfterStartOver(h, result ? { result, approved, doneIds } : null));
      wordingRef.current = [];
      setResult(out.result);
      setApproved(new Set());
      setChanges(out.notes);
      if (polishFailed(out, skippedPolish.current)) setPolishNote(POLISH_FAILED_NOTE);
      runWording(out.result.doc, m);
      setPlacements([]);
      setChangedFrom(null);
      resetReview();
      setPhase("ready");
    } catch (e) {
      retryRef.current = (o) => void generate(o);
      if (!isCancel(e)) setAiError(e);
      // A failed or cancelled "Tailor again" keeps the resume she had, still editable.
      setPhase(result ? "ready" : "idle");
    } finally {
      setPolishing(false);
      if (abortRef.current?.signal === signal) abortRef.current = null;
    }
  };

  useEffect(() => {
    onBusyChange?.(phase === "generating" || phase === "revising" || reviewing);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, reviewing]);
  // Leaving the panel (the dialog closed) doesn't stop a running call: its result is saved by
  // persistNow. Only her Cancel stops it.

  useEffect(() => {
    if (autoStart && master?.trim() && header && !started.current) {
      started.current = true;
      start();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoStart, master, header]);

  // The page as shown: the whole document measured on the real HTML rendering. Normally it already
  // fits; if it runs over, the lowest-relevance bullet goes; if short, the type grows within 11pt.
  const fitted = useMemo(() => {
    if (!result || !header) return null;
    return fitResume(result.doc, (d) => pageFill(header, d), fitOpts);
  }, [result, header, fitOpts]);

  // What the last update changed on the visible page (yellow marker). Empty before any update.
  const changeMarks = useMemo(() => (changedFrom && fitted ? diffDocs(changedFrom, fitted.doc) : []), [changedFrom, fitted]);

  // After an AI update: say how many spots are marked in yellow.
  useEffect(() => {
    if (!announceMarks.current || phase !== "ready") return;
    announceMarks.current = false;
    showFlash(updateDoneMessage(changeMarks.length));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [changeMarks, phase]);

  // Flags on the visible page, and the ones still waiting for her decision.
  const visibleFlags = useMemo(() => {
    if (!result || !fitted) return [];
    return result.flags.flatMap((f) => {
      const spot = toVisibleSpot(fitted.map, f.target);
      return spot ? [{ flag: f, spot }] : [];
    });
  }, [result, fitted]);
  const openFlags = useMemo(() => visibleFlags.filter((v) => !approved.has(v.flag.id)), [visibleFlags, approved]);

  // What gets downloaded: the page without blocked lines she hasn't kept.
  const finalDoc = useMemo(() => {
    if (!fitted) return null;
    return applyApprovals(
      fitted.doc,
      visibleFlags.map((v) => ({ ...v.flag, target: v.spot })),
      approved,
    );
  }, [fitted, visibleFlags, approved]);

  // In plain words, what was done differently for this job.
  // Lines still waiting for her OK aren't credited ("showing Go" for a bullet flagged as not that role).
  const tailoredFor = useMemo(() => {
    if (!fitted || !focus) return [];
    const unsure = openFlags.map((v) => ({ ...v.flag, severity: "block" as const, target: v.spot }));
    return explainTailoring(focus, { ...fitted, doc: applyApprovals(fitted.doc, unsure, new Set()) });
  }, [fitted, focus, openFlags]);

  // Share of the job's skills the page shows, vs. how many of them the full master profile has.
  const coverage = useMemo(() => {
    if (!finalDoc || !master) return null;
    const onPage = skillCoverage(skillsForJob, resumeText(finalDoc));
    const inProfile = skillCoverage(skillsForJob, master);
    if (!onPage || !inProfile) return null;
    return { before: inProfile.percent, after: onPage.percent };
  }, [finalDoc, master, skillsForJob]);

  // Save each new version (a generation, a revision, a decision) to this job, shortly after it settles.
  useEffect(() => {
    if (!finalDoc || !header || !result || phase !== "ready") return;
    if (loadedFromStore.current) {
      loadedFromStore.current = false; // just reopened: nothing new to save
      return;
    }
    setStoreState("saving");
    saver.schedule(async () => {
      try {
        const { renderResumeDocx } = await import("@/lib/resume/engine/render");
        const bytes = await renderResumeDocx(header, finalDoc);
        const approvedMessages = result.flags.filter((f) => approved.has(f.id)).map((f) => f.message);
        const id = await storeJobResume(application.id, bytes, { v: 2, doc: result.doc, approved: approvedMessages, final: finalDoc }, coverage ?? { before: 0, after: 0 });
        setStoredId(id);
        setStoreState("saved");
        onSaved?.(id);
        void refreshVersions();
      } catch (e) {
        setError(`Couldn't save this resume to the job: ${e instanceof Error ? e.message : String(e)}`);
        setStoreState("idle");
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [finalDoc, phase]);
  // Closing the panel right after a decision or an edit still saves it, instead of dropping it.
  useEffect(() => () => void saver.flush(), [saver]);

  const download = async () => {
    if (!finalDoc || !header) return;
    setPhase("saving");
    setError(null);
    try {
      const { renderResumeDocx } = await import("@/lib/resume/engine/render");
      const bytes = await renderResumeDocx(header, finalDoc);
      const fileName = tailoredFileName(fullName, application.company, application.role);
      setSaved(await exportResume(bytes, fileName, storedId ?? undefined));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPhase("ready");
    }
  };

  // The page preview scales to its box, so it fits a phone without scrolling sideways. A resize
  // closes the menu, whose position was measured against the old size.
  const hasPreview = fitted !== null;
  useEffect(() => {
    const box = previewBox.current;
    if (!box || typeof ResizeObserver === "undefined") return;
    const update = () => {
      const next = previewScale(box.clientWidth);
      if (Math.abs(scaleRef.current - next) < 0.001) return;
      scaleRef.current = next;
      setScale(next);
      setSelection(null);
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(box);
    return () => observer.disconnect();
  }, [hasPreview, phase]);
  // The open menu's target is a position in the page it was opened on; once the page changes
  // (a decision, an undo) that position can point at a different bullet, so close it.
  useEffect(() => setSelection(null), [fitted]);

  /** Rough height of the open menu, so it can open above a line near the bottom of the page. */
  const POPOVER_HEIGHT = 330;
  const POPOVER_WIDTH = 320;

  const openFor = (anchor: Element | null, quote: string, rect: DOMRect) => {
    const box = previewBox.current;
    if (!box || !quote) return;
    const outer = box.getBoundingClientRect();
    const place = popoverPlacement(
      { left: rect.left - outer.left, top: rect.top - outer.top, bottom: rect.bottom - outer.top },
      { width: outer.width, height: outer.height },
      { width: POPOVER_WIDTH, height: POPOVER_HEIGHT },
    );
    openedFrom.current = anchor instanceof HTMLElement ? anchor : null;
    setSelection({ quote, ...place, target: targetFromElement(anchor) });
    setPopoverMode("actions");
    setNote("");
  };

  /**
   * Selecting text, or just clicking a bullet, role or skills line, opens the action menu next to
   * it. The data attributes html.ts writes say exactly which part of the resume it is.
   */
  const onPreviewMouseUp = (e: React.MouseEvent) => {
    const sel = window.getSelection();
    if (!sel || !pageRef.current) return;
    if (!sel.isCollapsed && pageRef.current.contains(sel.anchorNode)) {
      const node = sel.anchorNode;
      openFor(node instanceof Element ? node : (node?.parentElement ?? null), sel.toString().replace(/\s+/g, " ").trim(), sel.getRangeAt(0).getBoundingClientRect());
      return;
    }
    const clicked = (e.target as Element).closest?.("[data-b], [data-sec]");
    if (!clicked || !pageRef.current.contains(clicked)) return;
    openFor(clicked, (clicked as HTMLElement).innerText.replace(/\s+/g, " ").trim(), clicked.getBoundingClientRect());
  };

  /** Enter or Space on a focused bullet, role or skills line opens the same menu. */
  const onPreviewKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    const el = (e.target as Element).closest?.("[data-b], [data-sec]");
    if (!el || !pageRef.current?.contains(el)) return;
    e.preventDefault();
    openFor(el, (el as HTMLElement).innerText.replace(/\s+/g, " ").trim(), el.getBoundingClientRect());
  };

  // While the menu is open: Escape and a click outside close only the menu (not the whole dialog),
  // and keyboard focus moves into it.
  useEffect(() => {
    if (!selection) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      e.preventDefault();
      closePopover();
    };
    const onDown = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) closePopover();
    };
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("mousedown", onDown, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("mousedown", onDown, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selection]);

  useEffect(() => {
    if (!selection) return;
    const first = popoverRef.current?.querySelector<HTMLElement>("textarea, button");
    first?.focus();
  }, [selection, popoverMode]);

  /** Apply a hand edit (no AI): re-check it against her experience, keep her decisions, allow undo. */
  const commitDoc = (next: ResumeDoc, masterText = masterRef.current, message?: string) => {
    // While an update is running its answer would replace this edit, so edits wait for it.
    if (!result || !masterText || phase !== "ready") return;
    const checked = validateResume(next, masterText, vopts());
    setHistory((h) => [...h, { result, approved, doneIds }]);
    // Hand edits and free adds are marked in yellow too; the base stays the page before the first one.
    setChangedFrom((base) => base ?? fitted?.doc ?? result.doc);
    setResult(checked);
    setApproved(carryApprovals(result.flags, approved, checked.flags));
    setChanges([]);
    setSaved(null);
    if (message) showFlash(message);
  };

  /** Remove and Edit act on what she clicked on the page, applied to the same spot in the document. */
  const commitOnPool = (visible: Target, change: (pool: ResumeDoc, target: Target) => ResumeDoc, message?: string) => {
    if (!result || !fitted) return;
    const target = toPoolTarget(fitted.map, visible);
    if (target) commitDoc(change(result.doc, target), undefined, message);
  };

  const keepFlag = (f: Flag) => setApproved((s) => new Set([...s, f.id]));
  const removeFlagged = (f: Flag) => {
    if (result) commitDoc(removeSpot(result.doc, f.target), undefined, "Removed that line. Undo brings it back.");
  };

  // Roles and projects on the page she can place a skill in, as written in her experience. From the
  // whole page (fitted), struck-through roles included, so a role waiting for her OK isn't hidden.
  const places = useMemo(() => (fitted && master ? placeOptions(fitted.doc, master) : []), [fitted, master]);

  /** One comment per skill she placed in a role, on that role's spot in the document. */
  const placementComments = (doc: ResumeDoc): ResumeComment[] =>
    placements.map((p) => placementComment(p.skill, p.how, placeTarget(doc, p.role.company), p.label));

  /**
   * One revision call with everything she asked for, plus any skills waiting to be placed. Runs
   * right away; the answer is checked like any generation (anything new still needs her OK).
   */
  const runRevision = async (requests: ResumeComment[], override: ProviderId | undefined = writerOverride): Promise<boolean> => {
    if (!result || phase !== "ready") return false;
    const all = [...requests, ...placementComments(result.doc)];
    if (all.length === 0) return false;
    const m = masterRef.current;
    setError(null);
    setAiError(null);
    setSaved(null);
    setSelection(null);
    setPhase("revising");
    setFallbackNote(null);
    const signal = newSignal();
    try {
      const out = await reviseResume(await providerFor("revise_resume", writerOpts(override)), m, application.company, application.jdText, result.doc, all, undefined, undefined, signal);
      const { changes: done, ...doc } = out;
      // An answer with no bullets would leave a blank page: keep the resume she has and say so.
      assertUsable(doc);
      // A model answer: the job's skills she has go back on the Skills lines if it dropped any.
      const next = validateResume(doc, m, vopts({ addJobSkills: true }));
      await persistNow(next, carryApprovals(result.flags, approved, next.flags), m);
      setHistory((h) => [...h, { result, approved, doneIds }]);
      setChangedFrom(fitted?.doc ?? result.doc);
      announceMarks.current = true;
      // Her current decisions, including any made while the update was running.
      setApproved((current) => carryApprovals(result.flags, current, next.flags));
      setResult(next);
      setChanges(done);
      runWording(next.doc, m);
      setPlacements([]);
      return true;
    } catch (e) {
      retryRef.current = (o) => void runRevision(requests, o);
      if (!isCancel(e)) setAiError(e);
      return false;
    } finally {
      if (abortRef.current?.signal === signal) abortRef.current = null;
      setPhase("ready");
    }
  };

  /** A request on the spot she clicked, sent right away. */
  const ask = (text: string) => {
    if (!selection || !text.trim()) return;
    const target = selection.target && fitted ? toPoolTarget(fitted.map, selection.target) : null;
    void runRevision([{ id: `ask-${Date.now()}`, quote: selection.quote, note: text.trim(), ...(target ? { target } : {}) }]);
  };

  /**
   * A job skill she added from the list. The skills section is updated right away (free). A skill
   * that isn't in her experience is saved to it (her click is the confirmation, decision #6), and a
   * role she chose is saved as a usage note tied to that exact role, so the validator accepts the
   * skill in that role's bullets; the rewrite itself waits for "Apply".
   */
  const addGap = async (skill: string, placeKey: string, how: string) => {
    if (!result || phase !== "ready") return;
    let m = masterRef.current;
    if (!hasSkill(skill, parseSkillInventory(m), m)) m = appendSkillToMaster(m, skill);
    const place = places.find((p) => p.key === placeKey);
    if (place) m = appendUsageNote(m, skill, how, place.role);
    if (m !== masterRef.current) {
      try {
        await saveMasterProfile(m);
      } catch (e) {
        setError(`Couldn't save ${skill} to Your experience: ${e instanceof Error ? e.message : String(e)}`);
        return;
      }
      setMaster(m);
    }
    commitDoc(addSkill(result.doc, skill), m, place ? `${addedSkillMessage(skill)} Press Update to write it into ${place.label}.` : addedSkillMessage(skill));
    if (!place) setAddedToSkills((a) => (a.includes(skill) ? a : [...a, skill]));
    if (place) setPlacements((ps) => [...ps.filter((p) => !(p.skill === skill && p.label === place.label)), { skill, how, role: place.role, label: place.label }]);
  };

  const closePopover = () => {
    setSelection(null);
    window.getSelection()?.removeAllRanges();
    // Return keyboard focus to the line the menu was opened from.
    openedFrom.current?.focus?.();
    openedFrom.current = null;
  };

  // Writing quality, checked by code on the visible page: AI-sounding words, weak or repeated verbs,
  // lengths, bold use, repetition, and the job's keywords (lib/resume/quality).
  const quality = useMemo(() => {
    if (!finalDoc || !master) return null;
    const inventory = parseSkillInventory(master);
    const have = skillsForJob.filter((x) => hasSkill(x, inventory, master));
    const issues = lintResume(finalDoc, { jobSkills: have, requiredSkills });
    return { issues, ...qualityScore(issues) };
  }, [finalDoc, master, skillsForJob, requiredSkills]);

  // The job's key skills (required ones, or every job skill when none is marked required), and how
  // many the page shows and proves in a bullet. Counted by code, never by the model (decision #7).
  const keySkills = useMemo(() => {
    const req = requiredSkills.filter((s) => !isSoftSkill(s));
    return req.length ? req : skillsForJob;
  }, [requiredSkills, skillsForJob]);
  const readiness = useMemo(
    () => (finalDoc && master ? skillReadiness(finalDoc, keySkills, master, resumeText(finalDoc)) : null),
    [finalDoc, master, keySkills],
  );
  const readinessNow: ReadinessCounts | null = readiness ? { total: readiness.skills.length, shown: readiness.shown.length, proven: readiness.proven.length } : null;
  // The counts when this draft first showed (or the last review ran), for "before and now".
  useEffect(() => {
    if (!baseline && readinessNow && phase === "ready") setBaseline(readinessNow);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [readiness, phase]);

  // Reopened: the review saved with this job comes back with no AI call. On a page that changed
  // since, every item is kept, and ones about a spot that's gone are marked done (restoreReview).
  // The meters' current numbers are always counted from the page on screen.
  useEffect(() => {
    const stored = pendingReview.current;
    if (!stored || !fitted) return;
    pendingReview.current = null;
    const { review } = restoreReview(stored, fitted.doc);
    setReviewItems(review.items);
    setReviewSummary(review.summary);
    setQueued(new Map(review.queued.map((q) => [q.id, { comment: q.comment, quote: q.quote }])));
    setIgnored(new Set(review.ignored));
    setDoneIds(new Set(review.done));
    if (review.baseline) setBaseline(review.baseline);
    setReviewedFor(review.fingerprint);
    reviewHydrated.current = true;
  }, [fitted]);

  // The review as it would be stored, or null when there is none.
  const reviewToStore = useMemo((): Omit<StoredReview, "savedAt"> | null => {
    if (reviewSummary === null && reviewItems.length === 0 && queued.size === 0 && ignored.size === 0) return null;
    return {
      summary: reviewSummary,
      items: reviewItems,
      queued: [...queued].map(([id, q]) => ({ id, comment: q.comment, ...(q.quote !== undefined ? { quote: q.quote } : {}) })),
      ignored: [...ignored],
      done: [...doneIds],
      baseline,
      fingerprint: reviewedFor ?? (fitted ? docFingerprint(fitted.doc) : ""),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reviewSummary, reviewItems, queued, ignored, doneIds, baseline, reviewedFor]);

  // Saved with the job's resume shortly after it changes (no new version, no AI call).
  useEffect(() => {
    if (!reviewHydrated.current) return;
    reviewSaver.schedule(async () => {
      try {
        await saveJobReview(application.id, reviewToStore ? { ...reviewToStore, savedAt: Date.now() } : null);
      } catch {
        // Only the review's own save failed; the resume itself is saved separately.
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reviewToStore]);
  useEffect(() => () => void reviewSaver.flush(), [reviewSaver]);

  const planContext = (doc: ResumeDoc) => ({
    doc,
    master: masterRef.current,
    keySkills,
    jobSkills: skillsForJob,
    isRequired: (s: string) => requiredSkills.some((r) => r.toLowerCase() === s.toLowerCase()),
  });
  // Free items found by code on the page as it is now, merged with the model's items from the last
  // review (one row per skill), minus what she ignored or already applied.
  const reviewList = useMemo(() => {
    if (!fitted || !master) return [];
    const code = codeReviewItems(planContext(fitted.doc));
    // A skill she already placed in a role waits in "Apply" below, so its question is answered.
    const placed = new Set(placements.map((p) => normalizeSkill(p.skill)));
    const placedHere = (i: ReviewItem) =>
      ("skill" in i.action && placed.has(normalizeSkill(i.action.skill))) || (i.id.startsWith("code:prove:") && placed.has(i.id.slice("code:prove:".length)));
    return mergeReviewItems(code, reviewItems).filter((i) => !ignored.has(i.id) && !doneIds.has(i.id) && !placedHere(i));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitted, master, reviewItems, ignored, doneIds, keySkills, skillsForJob, requiredSkills, placements]);

  /** One review call on the page as she sees it. Code then decides what each item may do. */
  const runReview = async (override: ProviderId | undefined = writerOverride) => {
    if (!fitted || !readiness || phase !== "ready" || reviewing) return;
    setReviewing(true);
    setAiError(null);
    setFallbackNote(null);
    const signal = newSignal();
    try {
      const review = await reviewResume(
        await providerFor("review_resume", writerOpts(override)),
        masterRef.current,
        { company: application.company, role: application.role, jdText: application.jdText, doc: fitted.doc, readiness },
        undefined,
        signal,
      );
      setReviewItems(planReviewItems(review, planContext(fitted.doc)));
      setReviewSummary(review.summary || null);
      setReviewedFor(docFingerprint(fitted.doc));
      setQueued(new Map());
      setIgnored(new Set());
      setDoneIds(new Set());
      if (readinessNow) setBaseline(readinessNow);
    } catch (e) {
      retryRef.current = (o) => void runReview(o);
      if (!isCancel(e)) setAiError(e);
    } finally {
      if (abortRef.current?.signal === signal) abortRef.current = null;
      setReviewing(false);
    }
  };

  const queueComment = (id: string, comment: ResumeComment, quote?: string) => setQueued((q) => new Map(q).set(id, { comment, quote }));

  /** The role on the page a fact question is about, as a place key, when it is about one. */
  const placeForItem = (item: ReviewItem): string | undefined => {
    if (!fitted) return undefined;
    const t = item.action.type === "ask_fact" && item.action.target ? item.action.target : item.target;
    const now = relocateTarget(fitted.doc, t, item.quote) ?? t;
    if (!now || (now.section !== "experience" && now.section !== "projects")) return undefined;
    const e = (fitted.doc[now.section] ?? [])[now.entry];
    return e ? places.find((p) => p.section === now.section && norm(p.role.company) === norm(e.company))?.key : undefined;
  };

  /**
   * Her typed answer to a fact question is queued for the next update. With "Also save to my
   * experience", it's first saved to that role in Your experience (master/facts.ts, keeping the
   * earlier text as a version). Her answer is her confirmation (decision #6): validate.ts then
   * accepts it in that role's bullets only.
   */
  const answerFact = async (item: ReviewItem, answer: string, placeKey: string | null) => {
    if (!answer.trim()) return;
    const place = placeKey ? places.find((p) => p.key === placeKey) : undefined;
    if (place) {
      try {
        setMaster(await saveRoleFact(place.role, answer));
      } catch (e) {
        setError(`Couldn't save your answer to Your experience: ${e instanceof Error ? e.message : String(e)}`);
        return;
      }
    }
    queueComment(item.id, answerComment(item, answer), item.quote);
  };

  /** Every queued item in one update, each found again on the page as it is now. */
  const applyQueued = async () => {
    if (!fitted) return;
    const comments = [...queued.values()].map(({ comment, quote }) => {
      const visible = relocateTarget(fitted.doc, comment.target, quote);
      const target = visible ? toPoolTarget(fitted.map, visible) : null;
      const rest: ResumeComment = { id: comment.id, quote: comment.quote, note: comment.note };
      return target ? { ...rest, target } : rest;
    });
    const ids = [...queued.keys()];
    if (await runRevision(comments)) {
      setDoneIds((d) => new Set([...d, ...ids]));
      setQueued(new Map());
    }
  };

  const undo = () => {
    const prev = history[history.length - 1];
    if (!prev) return;
    setResult(prev.result);
    setApproved(prev.approved);
    setHistory((h) => h.slice(0, -1));
    setChanges([]);
    setChangedFrom(null);
    // Only the review items applied in the update she undid can be applied again.
    setDoneIds(prev.doneIds);
  };

  /** Brings back an earlier saved version (free). The one on screen stays one Undo away and is kept as a version too. */
  const restoreVersion = (v: PreviousVersion) => {
    if (!result || phase !== "ready") return;
    const m = masterRef.current;
    const restored = validateResume(v.doc, m, vopts());
    const ticked = new Set(v.approved.map(normalizeFlagMessage));
    setHistory((h) => [...h, { result, approved, doneIds }]);
    setResult(restored);
    setApproved(new Set(restored.flags.filter((f) => ticked.has(f.message)).map((f) => f.id)));
    setChanges([]);
    setChangedFrom(null);
    setSaved(null);
  };

  if (master === null || header === null) return <Spinner label="Loading your experience..." />;

  if (!master.trim()) {
    return (
      <Notice kind="info">
        Add Your experience first. It holds everything you&apos;ve done and is the only source tailoring may use.{" "}
        <Link href="/resumes#your-experience" className="font-medium underline">
          Go to Resumes
        </Link>
        .
      </Notice>
    );
  }

  if (phase === "generating") {
    return <TailorProgress progress={progress} onCancel={cancelRun} writer={writerLabel} />;
  }


  // OpenAI can't write right now (no key, rejected, no credit, model): offer to fix it or use Claude.
  const aiNotice = canFallBackToClaude(aiError) ? (
    <WriterFallbackNotice
      error={aiError}
      disabled={phase === "revising" || phase === "saving"}
      onRetry={() => {
        setAiError(null);
        retryRef.current?.(undefined);
      }}
      onUseClaude={() => {
        setWriterOverride("anthropic");
        setAiError(null);
        retryRef.current?.("anthropic");
      }}
    />
  ) : (
    <AIErrorNotice error={aiError} />
  );

  if (!result || !fitted || !finalDoc) {
    return (
      <div className="rounded-2xl bg-paper p-4">
        {notStartedReason && <p className="mb-3 text-sm text-muted">{notStartedReason}</p>}
        <Button onClick={() => void generate()}>Tailor resume</Button>
        {error && <Notice kind="error">{error}</Notice>}
        {aiError !== null && aiNotice}
      </div>
    );
  }

  const busy = phase !== "ready";
  const { fixes } = result;
  const swapOptions = selection?.target?.section === "experience" && selection.target.bullet === undefined ? entriesNotOnPage(master, fitted.doc) : [];
  const targetLabel = selection?.target ? describeTarget(fitted.doc, selection.target) : null;
  const editable = selection?.target ? textOfTarget(fitted.doc, selection.target) : null;
  const flagsHere = selection?.target ? openFlags.filter((v) => spotOn(v.spot, selection.target!)) : [];
  const fillPercent = Math.round(fitted.fill * 100);
  const blocked = openFlags.filter((v) => v.flag.severity === "block").length;
  // Short of a full page at the FINAL fill (after the type grew). The paid fill update is offered
  // only when her experience still has bullets for these roles that the page doesn't say.
  const offer = fillOffer(fitted.doc, master, fitted.fill, fitted.fits);
  const short = offer.canFill ? offer.short : 0;

  // Her final check of the finished page (lib/resume/engine/verify.ts), plus what code fixed.
  const verified = withOpenFlags(
    verifyResume({ header, doc: finalDoc, fits: fitted.fits, fill: fitted.fill, master }),
    openFlags.map((v) => v.flag).filter((f) => f.kind !== "wording"),
  );
  const qualityFixes = quality?.issues.filter((i) => i.severity === "fix") ?? [];
  const checks = [
    ...verified.filter((c) => c.id !== "one-page" && c.id !== "fill").map((c) => ({ ok: c.ok, text: c.label })),
    // Hard requirements of the job she may not meet, as the tailoring call saw them.
    ...(result.doc.meta.warnings ?? []).map((w) => ({ ok: false, text: `Heads-up: ${w}` })),
    {
      ok: openFlags.length === 0,
      text:
        openFlags.length === 0
          ? "Every skill, number, employer and date was found in Your experience"
          : `${openFlags.length} line${openFlags.length === 1 ? "" : "s"} marked on the page for you to keep or remove`,
    },
    {
      ok: fitted.fits && !fitted.underfilled,
      text: !fitted.fits
        ? "Still over one page; check it in Word"
        : fitted.underfilled
          ? `Fits on one page but uses only ${fillPercent}% of it`
          : `Fits on one page and uses ${fillPercent}% of it`,
    },
    { ok: qualityFixes.length === 0, text: qualityFixes.length ? `${qualityFixes.length} writing issue${qualityFixes.length === 1 ? "" : "s"} to fix` : "No weak verbs, buzzwords or overlong bullets" },
  ];
  const failing = checks.filter((c) => !c.ok).length;
  // The things the model can fix, sent in ONE update: writing issues code found, and a short page.
  const fixList = [...qualityFixes.map((i) => i.id), ...(fitted.underfilled && short > 0 ? ["fill"] : [])];
  const fixComments = (): ResumeComment[] => [
    ...issuesToComments(quality?.issues ?? []).map((c) => {
      const target = c.target ? toPoolTarget(fitted.map, c.target) : null;
      return { ...c, target: target ?? undefined };
    }),
    ...(fitted.underfilled && short > 0 ? [{ id: "fill", quote: "", note: fillComment(short) }] : []),
  ];
  const autoFixed = [...fixes, ...fitted.steps, ...(fitted.removed.length ? [`Left off ${fitted.removed.length} less relevant line${fitted.removed.length === 1 ? "" : "s"} to fit one page.`] : [])];

  const checksList = (
    <>
      <ul className="grid gap-1.5 text-sm">
        {checks.map((c) => (
          <li key={c.text} className="flex gap-2">
            <CheckIcon ok={c.ok} />
            <span>{c.text}</span>
          </li>
        ))}
      </ul>
      {offer.note && fitted.underfilled && <p className="mt-2 text-xs text-muted">{offer.note}</p>}
      {autoFixed.length > 0 && <p className="mt-2 text-xs text-muted">Fixed automatically: {autoFixed.join(" ")}</p>}
      {fixList.length > 0 && (
        <div className="mt-3">
          <QualityCard
            score={quality?.score ?? 100}
            issues={quality?.issues ?? []}
            shortLines={fitted.underfilled ? short : 0}
            onFix={() => void runRevision(fixComments())}
            queued={phase === "revising"}
            disabled={busy}
          />
        </div>
      )}
    </>
  );

  const errorBlock =
    error || aiError !== null ? (
      <div ref={alertRef} className="grid gap-3">
        {error && <Notice kind="error">{error}</Notice>}
        {aiError !== null && aiNotice}
        {aiError !== null && !canFallBackToClaude(aiError) && retryRef.current && describeAIError(aiError).retryable && (
          <div>
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() => {
                setAiError(null);
                retryRef.current?.(undefined);
              }}
            >
              Try again
            </Button>
          </div>
        )}
      </div>
    ) : null;

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-4">
      {phase === "revising" && (
        // Sticky under the dialog title, so a rewrite far down the page is never silent.
        <div className="sticky top-[4.5rem] z-30 rounded-xl bg-white p-3 shadow-card ring-1 ring-black/[0.06]" role="status">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Spinner label={polishing ? "Your draft is ready. Polishing it: naming the job's key skills in your bullets..." : "Updating your resume. This takes about 30 seconds..."} />
            <Button size="sm" variant="secondary" onClick={cancelRun}>
              {polishing ? "Skip polishing" : "Cancel"}
            </Button>
          </div>
          <SlowNote />
        </div>
      )}
      {flash && phase !== "revising" && (
        <p
          role="status"
          className={`sticky top-[4.5rem] z-30 rounded-xl bg-accent-soft px-3 py-2 text-[13px] font-medium text-accent-deep shadow-card transition-opacity duration-500 ${flash.fading ? "opacity-0" : "opacity-100"}`}
        >
          {flash.text}
        </p>
      )}
      {errorBlock}
      {polishNote && !errorBlock && <p className="text-[13px] text-muted">{polishNote}</p>}
      <TailoredForCard lines={tailoredFor} />

      {openFlags.length > 0 && (
        <section className="rounded-2xl bg-warn-soft p-5" aria-labelledby="flags-heading">
          <h3 id="flags-heading" className="text-[15px] font-semibold tracking-display">
            {openFlags.length} line{openFlags.length === 1 ? " needs" : "s need"} your OK
          </h3>
          <p className="mb-3 mt-0.5 text-xs text-muted">Keep a line to put it in the download, or remove it. Nothing that isn&apos;t in Your experience is used until you keep it.</p>
          <ul className="grid gap-3">
            {openFlags.map(({ flag }) => (
              <FlagRow key={flag.id} flag={flag} onKeep={() => keepFlag(flag)} onRemove={() => removeFlagged(flag)} disabled={busy} />
            ))}
          </ul>
        </section>
      )}

      <div>
        <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
          <p className="text-[15px] font-semibold tracking-display">Your resume</p>
          <p className="text-xs text-muted">Click a line, or select any text, to change it. {TIME_LINE}</p>
        </div>
        {changeMarks.length > 0 && (
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2 rounded-xl bg-paper px-3 py-2 text-xs text-muted">
            <span className="flex items-center gap-2">
              <span className="inline-block h-3 w-5 rounded-sm bg-marker" aria-hidden="true" />
              {changeMarks.length} spot{changeMarks.length === 1 ? "" : "s"} changed since the last version, marked in yellow. Select any of it to ask for more changes. The marker isn&apos;t in the download.
            </span>
            <button type="button" className="font-medium text-accent hover:underline" onClick={() => setChangedFrom(null)}>
              Hide highlights
            </button>
          </div>
        )}
        <div ref={previewBox} className="relative min-w-0 rounded-2xl bg-paper p-3" onMouseUp={onPreviewMouseUp} onKeyDown={onPreviewKeyDown}>
          <div className="mx-auto shadow-lift" style={{ width: `${8.5 * scale}in`, height: `${11 * scale}in`, overflow: "hidden" }}>
            <div ref={pageRef} style={{ transform: `scale(${scale})`, transformOrigin: "top left", width: "8.5in" }}>
              <style dangerouslySetInnerHTML={{ __html: PAGE_CSS }} />
              {/* renderResumeHtml escapes every string; no model output is inserted as raw HTML. */}
              <div dangerouslySetInnerHTML={{ __html: renderResumeHtml(header, fitted.doc, openFlags.map((v) => ({ kind: v.flag.severity, spot: v.spot })), changeMarks) }} />
            </div>
          </div>
          {selection && (
            <div
              ref={popoverRef}
              role="dialog"
              aria-label="Change this part of the resume"
              className="absolute z-20 overflow-auto rounded-2xl bg-white p-4 shadow-card ring-1 ring-black/[0.08]"
              style={{ left: selection.x, top: selection.y, width: selection.width, maxHeight: selection.maxHeight }}
              onMouseUp={(e) => e.stopPropagation()}
            >
              {targetLabel && <p className="text-xs font-medium text-muted">{targetLabel[0].toUpperCase() + targetLabel.slice(1)}</p>}
              <p className="mt-1 line-clamp-2 border-l-2 border-accent pl-2 text-xs text-muted">{selection.quote}</p>

              {flagsHere.length > 0 && popoverMode === "actions" && (
                <ul className="mt-3 grid gap-2 rounded-xl bg-warn-soft p-2">
                  {flagsHere.map(({ flag }) => (
                    <FlagRow
                      key={flag.id}
                      flag={flag}
                      onKeep={() => {
                        keepFlag(flag);
                        closePopover();
                      }}
                      onRemove={() => {
                        removeFlagged(flag);
                        closePopover();
                      }}
                      disabled={busy}
                    />
                  ))}
                </ul>
              )}

              {popoverMode === "actions" && (
                <div className="mt-3 grid gap-1">
                  {editable !== null && (
                    <PopoverAction
                      onClick={() => {
                        setEditText(editable);
                        setPopoverMode("edit");
                      }}
                      label="Edit the text yourself"
                      hint="Free and instant. Words between ** stay bold"
                    />
                  )}
                  {swapOptions.length > 0 && <PopoverAction onClick={() => setPopoverMode("swap")} label="Swap for another experience" hint="Pick a role from Your experience" />}
                  <PopoverAction
                    onClick={() => ask("Rewrite this to match the job's wording and keywords. Keep every fact, number and technology.")}
                    label="Rewrite for this job"
                    hint="Updates the resume now"
                  />
                  <PopoverAction
                    onClick={() => ask("Make this shorter, one line if possible, keeping its number and main technology.")}
                    label="Make it shorter"
                    hint="Updates the resume now"
                  />
                  <PopoverAction onClick={() => setPopoverMode("custom")} label="Ask for something else" hint="Type what to change, e.g. mention the Jest tests" />
                  {selection.target && (
                    <PopoverAction
                      danger
                      onClick={() => {
                        commitOnPool(selection.target!, removeTarget, "Removed. Undo brings it back.");
                        closePopover();
                      }}
                      label={selection.target.bullet === undefined && selection.target.section !== "leadership" ? "Remove this whole section" : "Remove"}
                      hint="Right away, free. You can undo it"
                    />
                  )}
                </div>
              )}

              {popoverMode === "swap" && (
                <div className="mt-3">
                  <p className="mb-2 text-[13px] font-medium">Replace it with</p>
                  <div className="grid max-h-56 gap-1 overflow-auto">
                    {swapOptions.map((m) => (
                      <button
                        key={`${m.company}-${m.title}`}
                        type="button"
                        onClick={() =>
                          ask(
                            `Replace this whole role with my "${cleanTitle(m.title)} | ${m.company} | ${m.dates}" entry from Your experience (the master profile). Choose and rewrite its bullets that best match this job, about as many bullets as this role has now, and keep reverse-chronological order.`,
                          )
                        }
                        className="rounded-xl px-3 py-2 text-left transition hover:bg-paper"
                      >
                        <span className="block text-[13px] font-medium">{m.company}</span>
                        <span className="block text-xs text-muted">
                          {m.title} · {m.dates}
                        </span>
                      </button>
                    ))}
                  </div>
                  <button type="button" onClick={() => setPopoverMode("actions")} className="mt-2 text-xs text-muted hover:text-ink">
                    Back
                  </button>
                </div>
              )}

              {popoverMode === "edit" && selection.target && (
                <>
                  <textarea
                    rows={selection.target.section === "skills" ? 2 : 4}
                    value={editText}
                    onChange={(e) => setEditText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                        commitOnPool(selection.target!, (pool, t) => editTarget(pool, t, editText), "Saved your edit.");
                        closePopover();
                      }
                    }}
                    aria-label="Edit the text"
                    className={`mt-3 ${inputClass} text-sm`}
                  />
                  <p className="mt-1 text-xs text-muted">
                    {selection.target.section === "skills" ? "Separate skills with commas." : "Anything new that isn't in your experience is marked for you to keep."}
                  </p>
                  <div className="mt-2 flex justify-between gap-2">
                    <Button variant="secondary" onClick={() => setPopoverMode("actions")}>
                      Back
                    </Button>
                    <Button
                      onClick={() => {
                        commitOnPool(selection.target!, (pool, t) => editTarget(pool, t, editText), "Saved your edit.");
                        closePopover();
                      }}
                      disabled={!editText.trim() || editText.trim() === editable}
                    >
                      Save
                    </Button>
                  </div>
                </>
              )}

              {popoverMode === "custom" && (
                <>
                  <textarea
                    autoFocus
                    rows={3}
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) ask(note);
                    }}
                    placeholder="What should change? e.g. Mention that I used Docker here"
                    className={`mt-3 ${inputClass} text-sm`}
                  />
                  <div className="mt-2 flex justify-between gap-2">
                    <Button variant="secondary" onClick={() => setPopoverMode("actions")}>
                      Back
                    </Button>
                    <Button onClick={() => ask(note)} disabled={!note.trim()}>
                      Update resume
                    </Button>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </div>

      {readinessNow && (
        <RecruiterReviewCard
          company={application.company}
          now={readinessNow}
          before={baseline}
          summary={reviewSummary}
          items={reviewList}
          queuedIds={new Set(queued.keys())}
          ignoredCount={ignored.size}
          places={places}
          pendingPlacements={placements.map((p) => ({ skill: p.skill, placeLabel: p.label }))}
          addedToSkills={addedToSkills}
          onQueue={(item) => {
            if (item.action.type === "revise") queueComment(item.id, item.action.comment, item.quote);
          }}
          onUnqueue={(id) =>
            setQueued((q) => {
              const next = new Map(q);
              next.delete(id);
              return next;
            })
          }
          onIgnore={(id) => setIgnored((s) => new Set([...s, id]))}
          onShowIgnored={() => setIgnored(new Set())}
          onAddSkill={(skill, place, how) => void addGap(skill, place, how)}
          placeForItem={placeForItem}
          onAnswer={(item, answer, placeKey) => void answerFact(item, answer, placeKey)}
          onCancelPlacement={(i) => setPlacements((ps) => ps.filter((_, k) => k !== i))}
          onApply={() => void applyQueued()}
          onReview={() => void runReview()}
          reviewing={reviewing}
          reviewed={reviewSummary !== null || reviewItems.length > 0}
          disabled={busy || reviewing}
        />
      )}

      <AskForChanges
        onSend={(text) => void runRevision([{ id: `ask-${Date.now()}`, quote: "", note: text }])}
        busy={phase === "revising"}
        disabled={busy}
        changes={changes}
      />


      <section className="rounded-2xl bg-paper p-5" aria-label="Checks">
        {failing === 0 ? (
          <details>
            <summary className="flex cursor-pointer items-center gap-2 text-[15px] font-semibold tracking-display">
              <CheckIcon ok />
              All {checks.length} checks passed
            </summary>
            <div className="mt-3">{checksList}</div>
          </details>
        ) : (
          <>
            <p className="mb-3 text-[15px] font-semibold tracking-display">Checks</p>
            {checksList}
          </>
        )}
      </section>

      {fallbackNote ? <p className="text-[13px] text-muted">{fallbackNote}</p> : writerLabel && <p className="text-[13px] text-muted">New versions and updates are written with {writerLabel}. Change it in Settings.</p>}
      {saved && (
        <Notice kind="ok">
          Downloaded {saved.fileName}
          {saved.toFolder ? " and saved a copy to your Tailored folder" : ""}.
          {saved.folderWarning && ` ${saved.folderWarning}`}
        </Notice>
      )}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => setConfirmStart(true)} disabled={busy}>
            Tailor again
          </Button>
          {history.length > 0 && (
            <Button variant="secondary" onClick={undo} disabled={busy}>
              Undo
            </Button>
          )}
        </div>
        <span className="ml-auto text-xs text-muted" aria-live="polite">
          {storeState === "saving" ? "Saving to this job..." : storeState === "saved" ? "Saved to this job" : ""}
          {blocked > 0 ? `${storeState !== "idle" ? ". " : ""}${blocked} struck line${blocked === 1 ? " is" : "s are"} left out of the download` : ""}
        </span>
        <Button variant={queued.size + placements.length > 0 ? "secondary" : "primary"} onClick={download} disabled={busy}>
          {phase === "saving" ? "Saving..." : "Download .docx"}
        </Button>
      </div>

      {previousVersions.length > 0 && (
        <details className="rounded-2xl bg-paper px-4 py-3 text-[13px]">
          <summary className="cursor-pointer font-medium">Earlier versions ({previousVersions.length})</summary>
          <p className="mt-1 text-xs text-muted">{previousVersions.length === 1 ? "The version saved before this one." : `The last ${previousVersions.length} saved before this one.`} Restoring is free, and the version on screen is kept.</p>
          <ul className="mt-2 grid gap-1.5">
            {previousVersions.map((v) => (
              <li key={v.savedAt} className="flex items-center justify-between gap-2">
                <span>
                  Saved {v.savedAt ? new Date(v.savedAt).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "earlier"}
                  <span className="text-muted"> · {v.final.experience.length} role{v.final.experience.length === 1 ? "" : "s"}</span>
                </span>
                <Button size="sm" variant="secondary" onClick={() => restoreVersion(v)} disabled={busy}>
                  Restore
                </Button>
              </li>
            ))}
          </ul>
        </details>
      )}

      {confirmStart && (
        <ConfirmDialog
          title="Tailor again?"
          message={`This writes a new resume for this job from scratch (about a minute). The one you have now stays one Undo away and under Earlier versions.`}
          confirmLabel="Tailor again"
          onCancel={() => setConfirmStart(false)}
          onConfirm={() => {
            setConfirmStart(false);
            start();
          }}
        />
      )}
    </div>
  );
}
