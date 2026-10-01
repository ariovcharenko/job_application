"use client";

import { useLiveQuery } from "dexie-react-hooks";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { db, getMasterProfile, getPreferences, getProfile, getSettings } from "@/lib/db";
import { CAPTURE_EVENT, takeCapturedJob, type CapturedJob } from "@/lib/extensionCapture";
import { looksLikeUrl } from "@/lib/intake/analyze";
import { readyToApply, refreshStoredAnalyses } from "@/lib/intake/stored";
import { readiness } from "@/lib/readiness";
import { hasApiKey } from "@/lib/wipe";
import { downloadBlob } from "@/lib/download";
import { exportCsv } from "@/lib/tracker/csvMap";
import { blankApplication } from "@/lib/tracker/blank";
import { completeFollowUp, daysBetween, needsFollowUp, snoozeFollowUp, todayISO } from "@/lib/tracker/stage";
import { sortApplications } from "@/lib/tracker/sort";
import { isTracked, skipJob, trackJob } from "@/lib/tracker/triage";
import { ROLE_TYPES, STAGES, type Application } from "@/lib/types";
import { OPEN_ADD_JOB_EVENT } from "@/components/Nav";
import { deleteApplication, saveApplication } from "@/lib/tracker/repo";
import { Button, ConfirmDialog, EmptyState, inputClass, Modal, Spinner } from "@/components/ui";
import ApiKeyCard from "@/components/settings/ApiKeyCard";
import ReadinessStrip from "@/components/ReadinessStrip";
import SetupCard from "@/components/SetupCard";
import ApplicationForm from "./ApplicationForm";
import CheckedJobs from "./CheckedJobs";
import ImportDialog from "./ImportDialog";
import NewJobDialog from "./NewJobDialog";
import { CompanyMark } from "./StageBadge";
import TrackerBoard from "./TrackerBoard";
import TrackerTable from "./TrackerTable";

type View = "table" | "board";

const toolbarSelect = inputClass.replace("w-full", "w-auto");

function Stat({ label, value, detail }: { label: string; value: React.ReactNode; detail?: string }) {
  return (
    <div className="rounded-[22px] bg-white px-5 py-5 shadow-soft">
      <p className="text-[13px] font-medium text-muted">{label}</p>
      <p className="mt-2 text-[34px] font-semibold leading-none tracking-display tabular-nums">{value}</p>
      {detail && <p className="mt-2 text-xs text-muted">{detail}</p>}
    </div>
  );
}

/**
 * A job she can act on now: ready to apply, or a follow-up that's due. The whole card opens the
 * job (a button stretched over the card), and a due follow-up gets "Done" and "Snooze a week" as
 * sibling buttons layered above it, so no button sits inside another.
 */
function UpNextCard({
  app,
  badge,
  tone,
  onOpen,
  onDone,
  onSnooze,
}: {
  app: Application;
  badge: string;
  tone: "blue" | "amber";
  onOpen: () => void;
  onDone?: () => void;
  onSnooze?: () => void;
}) {
  const openLabel = tone === "blue" ? (app.tailoredResumeId !== undefined ? "Resume ready. Open" : "Open and tailor") : "Open";
  const smallAction =
    "relative z-10 rounded-full bg-black/[0.05] px-3 py-1 text-xs font-medium text-ink transition hover:bg-black/[0.08] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent";
  return (
    <div className="group relative flex w-64 shrink-0 flex-col rounded-[22px] bg-white p-5 text-left shadow-soft transition hover:-translate-y-0.5 hover:shadow-lift focus-within:shadow-lift">
      <div className="flex items-center justify-between">
        <CompanyMark name={app.company} size="md" />
        <span
          className={`rounded-full px-2.5 py-1 text-xs font-semibold tabular-nums ${tone === "blue" ? "bg-accent-soft text-accent-deep" : "bg-warn-soft text-warn"}`}
        >
          {badge}
        </span>
      </div>
      <p className="mt-4 font-semibold tracking-display">{app.company || "Untitled"}</p>
      <p className="mt-0.5 line-clamp-2 text-sm text-muted">{app.role}</p>
      <div className="mt-auto flex flex-wrap items-center gap-2 pt-4">
        <button
          type="button"
          onClick={onOpen}
          aria-label={`${openLabel}: ${[app.role, app.company].filter(Boolean).join(" at ") || "job"}`}
          className="text-[13px] font-medium text-accent outline-none after:absolute after:inset-0 after:rounded-[22px] group-hover:underline focus-visible:after:ring-2 focus-visible:after:ring-accent"
        >
          {openLabel} ›
        </button>
        {onDone && (
          <button type="button" onClick={onDone} className={`${smallAction} ml-auto`}>
            Done
          </button>
        )}
        {onSnooze && (
          <button type="button" onClick={onSnooze} className={smallAction}>
            Snooze a week
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * Asked for when she tries to check a job with no API key saved: the key card right here, then
 * "Continue" picks up exactly what she was doing (never a dead end or a trip to Settings).
 */
function KeyNeededDialog({ onContinue, onClose }: { onContinue: () => void; onClose: () => void }) {
  const [savedKey, setSavedKey] = useState("");
  return (
    <Modal title="Connect Claude to check jobs" onClose={onClose}>
      <p className="text-[15px] leading-relaxed text-muted">
        Reading and checking a job uses your own Anthropic API key (about 1 to 2¢ a job). Get one at{" "}
        <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noreferrer" className="text-accent hover:underline">
          console.anthropic.com
        </a>
        , add at least $5 of credit, and set a monthly spend limit. The key stays in this browser.
      </p>
      <div className="mt-5">
        <ApiKeyCard compact onSaved={setSavedKey} />
      </div>
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button
          disabled={!savedKey}
          onClick={() => {
            // The card autosaves; make sure the key really is stored before carrying on.
            void getSettings().then((s) => s.anthropicKey.trim() && onContinue());
          }}
        >
          Continue
        </Button>
      </div>
    </Modal>
  );
}

function download(name: string, text: string) {
  downloadBlob(new Blob([text], { type: "text/csv;charset=utf-8" }), name);
}

export default function TrackerView() {
  const apps = useLiveQuery(() => db.applications.toArray(), []);
  const [view, setView] = useState<View>("table");
  const [query, setQuery] = useState("");
  const [stage, setStage] = useState("");
  const [roleType, setRoleType] = useState("");
  const [editing, setEditing] = useState<Application | null>(null);
  const [importing, setImporting] = useState(false);
  const [pastingJob, setPastingJob] = useState(false);
  const [capturedJob, setCapturedJob] = useState<CapturedJob | null>(null);
  const [deleting, setDeleting] = useState<Application | null>(null);
  const [quickLink, setQuickLink] = useState("");
  const [quickError, setQuickError] = useState("");
  const [autoAnalyze, setAutoAnalyze] = useState(false);
  // What she was doing when a missing API key interrupted it; run once the key is saved.
  const [afterKey, setAfterKey] = useState<(() => void) | null>(null);
  const linkInput = useRef<HTMLInputElement>(null);

  // Setup progress, live: updates as soon as a key, Profile field or preference is saved.
  const setup = useLiveQuery(async () => {
    const [settings, profile, preferences, masterProfile] = await Promise.all([getSettings(), getProfile(), getPreferences(), getMasterProfile()]);
    return readiness({ settings, profile, preferences, masterProfile });
  }, []);

  /** Runs `then` now if an API key is saved, otherwise asks for one first and runs it after. */
  const withKey = (then: () => void) => {
    void hasApiKey().then((ok) => (ok ? then() : setAfterKey(() => then)));
  };

  // "Add job" in the nav links here with ?add=1 from any page.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("add")) {
      withKey(() => setPastingJob(true));
      window.history.replaceState(null, "", "/");
    } else if (params.get("import")) {
      // Onboarding's "Import a CSV".
      setImporting(true);
      window.history.replaceState(null, "", "/");
    }
    const open = () => withKey(() => setPastingJob(true));
    window.addEventListener(OPEN_ADD_JOB_EVENT, open);
    return () => window.removeEventListener(OPEN_ADD_JOB_EVENT, open);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Once per visit: re-assess saved jobs against her current Profile and preferences (free, no
  // AI): rows saved with their signals are fully re-run, older rows get their must-haves re-mapped.
  const refreshed = useRef(false);
  useEffect(() => {
    if (!apps || refreshed.current) return;
    refreshed.current = true;
    void Promise.all([getPreferences(), getProfile(), getMasterProfile()])
      .then(([prefs, profile, master]) => refreshStoredAnalyses(apps, prefs, profile, master))
      .then((rows) =>
        Promise.all(
          rows.map(({ app, fitBreakdown, fitScore }) =>
            db.applications.update(app.id!, fitScore === undefined ? { fitBreakdown } : { fitBreakdown, fitScore }),
          ),
        ),
      )
      .catch((e) => console.warn("Couldn't refresh saved job checks", e));
  }, [apps]);

  // Cmd/Ctrl+K jumps to the link box.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        linkInput.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const analyzeQuick = () => {
    const link = quickLink.trim();
    if (!looksLikeUrl(link)) {
      setQuickError("Paste the job posting's full link, starting with https://");
      return;
    }
    setQuickError("");
    withKey(() => {
      setCapturedJob({ url: link, text: "" });
      setAutoAnalyze(true);
      setPastingJob(true);
    });
  };

  useEffect(() => {
    const existing = takeCapturedJob();
    if (existing) {
      setCapturedJob(existing);
      withKey(() => setPastingJob(true));
    }
    const onCaptured = (e: Event) => {
      const detail = (e as CustomEvent<CapturedJob>).detail;
      setCapturedJob(detail);
      withKey(() => setPastingJob(true));
    };
    window.addEventListener(CAPTURE_EVENT, onCaptured);
    return () => window.removeEventListener(CAPTURE_EVENT, onCaptured);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The table, board, stats and export show only real applications; jobs she has only checked
  // (or said "Not applying" to) live in the Checked jobs section below.
  const tracked = useMemo(() => (apps ?? []).filter(isTracked), [apps]);
  const checkedOnly = useMemo(() => (apps ?? []).filter((a) => !isTracked(a)), [apps]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = tracked
      .filter((a) => !stage || a.stage === stage)
      .filter((a) => !roleType || a.roleType === roleType)
      .filter(
        (a) =>
          !q ||
          [a.company, a.role, a.location, a.contactName, a.referral, a.notes].some((f) => f.toLowerCase().includes(q)),
      );
    return sortApplications(list);
  }, [tracked, query, stage, roleType]);

  const stats = useMemo(() => {
    const list = tracked;
    const applied = list.filter((a) => a.stage !== "Saved");
    const responded = applied.filter((a) => a.respondDate);
    const gaps = responded.map((a) => daysBetween(a.appliedDate, a.respondDate)).filter((d): d is number => d !== null && d >= 0);
    return {
      total: list.length,
      applied: applied.length,
      responded: responded.length,
      rate: applied.length ? Math.round((responded.length / applied.length) * 100) : 0,
      avgDays: gaps.length ? Math.round(gaps.reduce((s, d) => s + d, 0) / gaps.length) : null,
    };
  }, [tracked]);

  const upNext = useMemo(() => {
    const list = apps ?? [];
    return {
      ready: readyToApply(list),
      followUps: list.filter((a) => needsFollowUp(a)),
    };
  }, [apps]);

  if (apps === undefined || setup === undefined) return <Spinner label="Loading your tracker..." />;

  // First run: no key and nothing saved yet. The setup card replaces the stats and table.
  const firstRun = apps.length === 0 && !setup.items.find((i) => i.key === "key")?.done;

  return (
    <>
      <section className="relative -mx-4 -mt-12 mb-14 overflow-hidden px-4 pb-4 pt-16 text-center sm:-mx-6 sm:px-6">
        <div className="hero-grid pointer-events-none absolute inset-0" aria-hidden="true" />
        <div className="relative">
          <h1 className="animate-rise mx-auto mt-2 max-w-3xl text-[44px] font-semibold leading-[1.05] tracking-display sm:text-[64px]" style={{ animationDelay: "60ms" }}>
            Apply to the jobs <span className="text-gradient">worth it.</span>
          </h1>
          <p className="animate-rise mx-auto mt-4 max-w-xl text-[19px] leading-snug text-muted sm:text-[21px]" style={{ animationDelay: "120ms" }}>
            Paste a job link. See if it meets your must-haves, how well your skills match, and get a tailored resume.
          </p>
          {/* Not a <form>: pressing Enter before the page finishes loading would do a native submit
              and reload the page, losing the link she just typed. */}
          <div
            role="search"
            className="animate-rise mx-auto mt-8 flex max-w-2xl items-center gap-2 rounded-full bg-white p-1.5 pl-5 shadow-lift ring-1 ring-black/[0.06] focus-within:ring-4 focus-within:ring-accent/20"
            style={{ animationDelay: "180ms" }}
          >
            <svg viewBox="0 0 24 24" className="h-5 w-5 shrink-0 text-muted" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7" />
            </svg>
            <input
              ref={linkInput}
              type="url"
              aria-label="Job posting link"
              placeholder="https://boards.greenhouse.io/..."
              value={quickLink}
              onChange={(e) => setQuickLink(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  analyzeQuick();
                }
              }}
              className="min-w-0 flex-1 bg-transparent py-2.5 text-[17px] outline-none placeholder:text-black/30"
            />
            <kbd className="hidden rounded-md border border-black/10 px-1.5 py-0.5 text-[11px] text-muted sm:block">⌘K</kbd>
            <button type="button" onClick={analyzeQuick} className="rounded-full bg-accent px-6 py-2.5 text-[15px] font-medium text-white transition hover:bg-accent-deep active:scale-[0.97]">
              Analyze
            </button>
          </div>
          {quickError && <p className="mt-3 text-sm text-bad">{quickError}</p>}
          <p className="mt-4 text-[13px] text-muted">
            About 1 to 2¢ per job.{" "}
            <button type="button" onClick={() => withKey(() => setPastingJob(true))} className="text-accent hover:underline">
              Or paste the description
            </button>
          </p>
        </div>
      </section>

      {firstRun ? (
        <SetupCard onImportCsv={() => setImporting(true)} />
      ) : (
        <>
          <ReadinessStrip readiness={setup} />

          {(upNext.ready.length > 0 || upNext.followUps.length > 0) && (
            <section className="mb-12">
              <h2 className="mb-4 text-[28px] font-semibold tracking-display">Up next</h2>
              <div className="-mx-4 flex gap-4 overflow-x-auto px-4 pb-3 sm:-mx-6 sm:px-6">
                {upNext.followUps.map((a) => (
                  <UpNextCard
                    key={`f-${a.id}`}
                    app={a}
                    badge="Follow up"
                    tone="amber"
                    onOpen={() => setEditing(a)}
                    onDone={() => void saveApplication(completeFollowUp(a))}
                    onSnooze={() => void saveApplication(snoozeFollowUp(a))}
                  />
                ))}
                {upNext.ready.slice(0, 8).map(({ app, percent }) => (
                  <UpNextCard key={`r-${app.id}`} app={app} badge={percent === null ? "Ready" : `${percent}% match`} tone="blue" onOpen={() => setEditing(app)} />
                ))}
              </div>
            </section>
          )}

          <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
            <h2 className="text-[28px] font-semibold tracking-display">Your applications</h2>
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" onClick={() => setImporting(true)}>
                Import CSV
              </Button>
              <Button
                variant="secondary"
                disabled={tracked.length === 0}
                onClick={() => download(`job-applications-${todayISO()}.csv`, exportCsv(tracked))}
              >
                Export CSV
              </Button>
              <Button variant="secondary" onClick={() => setEditing(blankApplication())}>
                Add manually
              </Button>
            </div>
          </div>

          <div className="mb-8 grid grid-cols-2 gap-4 md:grid-cols-4">
            <Stat label="Tracked" value={stats.total} />
            <Stat label="Applied" value={stats.applied} />
            <Stat label="Response rate" value={`${stats.rate}%`} detail={`${stats.responded} responded`} />
            <Stat label="Time to hear back" value={stats.avgDays !== null ? `${stats.avgDays}d` : "—"} detail="average" />
          </div>

          <div className="mb-4 flex flex-wrap items-center gap-2">
            <div className="relative w-full sm:w-72">
              <svg viewBox="0 0 24 24" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-black/35" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                <circle cx="11" cy="11" r="7" />
                <path d="m20 20-3.5-3.5" />
              </svg>
              <input
                type="search"
                aria-label="Search"
                placeholder="Search company, position, contact..."
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className={`${inputClass} pl-9`}
              />
            </div>
            <select aria-label="Filter by stage" value={stage} onChange={(e) => setStage(e.target.value)} className={toolbarSelect}>
              <option value="">All stages</option>
              {STAGES.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
            <select
              aria-label="Filter by role type"
              value={roleType}
              onChange={(e) => setRoleType(e.target.value)}
              className={toolbarSelect}
            >
              <option value="">All role types</option>
              {ROLE_TYPES.map((r) => (
                <option key={r}>{r}</option>
              ))}
            </select>
            <div className="ml-auto inline-flex rounded-full bg-black/[0.05] p-1 text-sm">
              {(["table", "board"] as View[]).map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setView(v)}
                  aria-pressed={view === v}
                  className={`rounded-full px-4 py-1.5 font-medium capitalize transition ${
                    view === v ? "bg-white text-ink shadow-soft" : "text-muted hover:text-ink"
                  }`}
                >
                  {v}
                </button>
              ))}
            </div>
          </div>

          {tracked.length === 0 ? (
            <EmptyState title="No applications yet">
              <p>Add one, or import a CSV from Notion, Airtable, Google Sheets or Excel.</p>
              <p className="mt-4">
                First time here?{" "}
                <Link href="/onboarding" className="font-medium text-accent hover:underline">
                  Walk through setup
                </Link>
                .
              </p>
            </EmptyState>
          ) : view === "table" ? (
            <TrackerTable apps={filtered} onOpen={setEditing} onDelete={setDeleting} />
          ) : (
            <TrackerBoard apps={filtered} onOpen={setEditing} />
          )}

          <CheckedJobs
            apps={checkedOnly}
            onOpen={setEditing}
            onTrack={(a) => saveApplication(trackJob(a))}
            onSkip={(a) => saveApplication(skipJob(a))}
            onRestore={(a) => saveApplication({ ...a, triage: "checked" })}
          />
        </>
      )}

      {afterKey && (
        <KeyNeededDialog
          onClose={() => setAfterKey(null)}
          onContinue={() => {
            const next = afterKey;
            setAfterKey(null);
            next();
          }}
        />
      )}
      {editing && <ApplicationForm key={editing.id ?? "new"} initial={editing} onClose={() => setEditing(null)} />}
      {importing && <ImportDialog onClose={() => setImporting(false)} />}
      {deleting?.id !== undefined && (
        <ConfirmDialog
          title="Delete this job?"
          message={
            <>
              {deleting.role || "This job"}
              {deleting.company ? ` at ${deleting.company}` : ""} will be removed from your tracker, along with its tailored resume and
              contacts saved in the app. Files already in your resume folder are kept. This can&apos;t be undone.
            </>
          }
          confirmLabel="Delete job"
          onCancel={() => setDeleting(null)}
          onConfirm={async () => {
            await deleteApplication(deleting.id!);
            setDeleting(null);
          }}
        />
      )}
      {pastingJob && (
        <NewJobDialog
          onClose={() => {
            setPastingJob(false);
            setCapturedJob(null);
            setAutoAnalyze(false);
            setQuickLink("");
          }}
          initialJdText={capturedJob?.text}
          initialUrl={capturedJob?.url}
          autoAnalyze={autoAnalyze}
          onOpenExisting={(a) => {
            setPastingJob(false);
            setCapturedJob(null);
            setAutoAnalyze(false);
            setQuickLink("");
            setEditing(a);
          }}
        />
      )}
    </>
  );
}
