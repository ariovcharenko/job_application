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
import { DEFAULT_VIEW_PREFS, filterApplications, hasActiveFilters, loadViewPrefs, saveViewPrefs, stageCounts, type TrackerView as View } from "@/lib/tracker/filter";
import { isTracked } from "@/lib/tracker/triage";
import { ROLE_TYPES, STAGES, type Application, type RoleType, type Stage } from "@/lib/types";
import { OPEN_ADD_JOB_EVENT } from "@/components/Nav";
import { deleteApplication, saveApplication, setTriage } from "@/lib/tracker/repo";
import { Button, ConfirmDialog, EmptyState, inputClass, Modal, Spinner } from "@/components/ui";
import ApiKeyCard from "@/components/settings/ApiKeyCard";
import ReadinessStrip from "@/components/ReadinessStrip";
import SetupCard from "@/components/SetupCard";
import ApplicationForm from "./ApplicationForm";
import CheckedJobs from "./CheckedJobs";
import ImportDialog from "./ImportDialog";
import NewJobDialog from "./NewJobDialog";
import DeleteJobMessage from "./DeleteJobMessage";
import { CompanyMark, STAGE_DOT } from "./StageBadge";
import TrackerBoard from "./TrackerBoard";
import TrackerTable from "./TrackerTable";

const toolbarSelect = inputClass.replace("w-full", "w-auto");

function Stat({ label, value, title }: { label: string; value: React.ReactNode; title?: string }) {
  return (
    <div className="rounded-[22px] bg-white px-5 py-4 shadow-soft" title={title}>
      <p className="text-[13px] font-medium text-muted">{label}</p>
      <p className="mt-1.5 text-[28px] font-semibold leading-none tracking-display tabular-nums">{value}</p>
    </div>
  );
}

/** Stage filter as chips with live counts ("Applied 4"), one tap each, "All" to clear. */
function StageChips({ counts, total, value, onChange }: { counts: Record<Stage, number>; total: number; value: Stage | ""; onChange: (s: Stage | "") => void }) {
  const chip = (on: boolean) =>
    `inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-[13px] font-medium transition focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-accent/25 ${
      on ? "bg-ink text-white" : "bg-white text-ink shadow-soft hover:bg-black/[0.03]"
    }`;
  return (
    <div role="group" aria-label="Filter by stage" className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0">
      <button type="button" aria-pressed={value === ""} onClick={() => onChange("")} className={chip(value === "")}>
        All <span className={`tabular-nums ${value === "" ? "text-white/70" : "text-muted"}`}>{total}</span>
      </button>
      {STAGES.map((s) => {
        const on = value === s;
        return (
          <button key={s} type="button" aria-pressed={on} onClick={() => onChange(on ? "" : s)} className={chip(on)}>
            {!on && <span className={`h-2 w-2 rounded-full ${STAGE_DOT[s]}`} aria-hidden="true" />}
            {s} <span className={`tabular-nums ${on ? "text-white/70" : "text-muted"}`}>{counts[s]}</span>
          </button>
        );
      })}
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
  const openLabel = tone === "blue" ? (app.tailoredResumeId !== undefined ? "Open" : "Open and tailor") : "Open";
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
          <button type="button" onClick={onSnooze} className={smallAction} title="Remind me again in a week">
            Snooze
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
        Checking a job uses your own Anthropic API key, about 1 to 2¢ a job. Get one at{" "}
        <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noreferrer" className="text-accent hover:underline">
          console.anthropic.com
        </a>
        .
      </p>
      <div className="mt-5">
        <ApiKeyCard compact onSaved={setSavedKey} />
      </div>
      <div className="flex justify-end gap-2 border-t border-black/[0.06] pt-5">
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
  const [view, setView] = useState<View>(DEFAULT_VIEW_PREFS.view);
  const [query, setQuery] = useState("");
  const [stage, setStage] = useState<Stage | "">(DEFAULT_VIEW_PREFS.stage);
  const [roleType, setRoleType] = useState<RoleType | "">(DEFAULT_VIEW_PREFS.roleType);
  // Table/Board and the stage/role filters are remembered in this browser. Read after mounting so
  // the first render matches the server's; saved only after that read, so defaults never overwrite them.
  const prefsLoaded = useRef(false);
  useEffect(() => {
    const p = loadViewPrefs();
    setView(p.view);
    setStage(p.stage);
    setRoleType(p.roleType);
    prefsLoaded.current = true;
  }, []);
  useEffect(() => {
    if (prefsLoaded.current) saveViewPrefs({ view, stage, roleType });
  }, [view, stage, roleType]);
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

  const filters = { query, stage, roleType };
  const filtered = useMemo(() => sortApplications(filterApplications(tracked, { query, stage, roleType })), [tracked, query, stage, roleType]);
  // Chip counts follow the search and role filters, so each chip says what tapping it would show.
  const counts = useMemo(() => stageCounts(filterApplications(tracked, { query, stage: "", roleType })), [tracked, query, roleType]);
  const clearFilters = () => {
    setQuery("");
    setStage("");
    setRoleType("");
  };

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
          <p className="animate-rise mx-auto mt-4 max-w-xl text-[17px] leading-snug text-muted sm:text-[21px]" style={{ animationDelay: "120ms" }}>
            Paste a job link. See if it fits, then tailor your resume.
          </p>
          {/* Not a <form>: pressing Enter before the page finishes loading would do a native submit
              and reload the page, losing the link she just typed. */}
          <div
            role="search"
            className="animate-rise mx-auto mt-8 flex max-w-2xl items-center gap-2 rounded-full bg-white p-1.5 pl-4 sm:pl-5 shadow-lift ring-1 ring-black/[0.06] focus-within:ring-4 focus-within:ring-accent/20"
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
              className="min-w-0 flex-1 bg-transparent py-2.5 text-base outline-none placeholder:text-black/40 sm:text-[17px]"
            />
            <kbd className="hidden rounded-md border border-black/10 px-1.5 py-0.5 text-[11px] text-muted sm:block">⌘K</kbd>
            <button
              type="button"
              onClick={analyzeQuick}
              className="shrink-0 rounded-full bg-accent px-5 py-2.5 text-[15px] font-medium text-white transition hover:bg-accent-deep focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-accent/25 active:scale-[0.97] sm:px-6"
            >
              Analyze
            </button>
          </div>
          <p className="mt-3 min-h-[20px] text-sm text-bad" role="alert">
            {quickError}
          </p>
          <p className="mt-1 text-[13px] text-muted">
            <button type="button" onClick={() => withKey(() => setPastingJob(true))} className="font-medium text-accent hover:underline">
              Paste a description instead
            </button>
            <span aria-hidden="true"> · </span>about 1 to 2¢ a job
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
              <h2 className="mb-4 text-[24px] font-semibold tracking-display sm:text-[28px]">
                Up next <span className="font-normal text-muted tabular-nums">{upNext.followUps.length + Math.min(upNext.ready.length, 8)}</span>
              </h2>
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

          <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-[24px] font-semibold tracking-display sm:text-[28px]">Your applications</h2>
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" onClick={() => setEditing(blankApplication())}>
                Add manually
              </Button>
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
            </div>
          </div>

          {tracked.length > 0 && (
            <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4 md:gap-4">
              <Stat label="Tracked" value={stats.total} />
              <Stat label="Applied" value={stats.applied} />
              <Stat label="Response rate" value={`${stats.rate}%`} title={`${stats.responded} of ${stats.applied} applied heard back`} />
              <Stat label="Avg. reply time" value={stats.avgDays !== null ? `${stats.avgDays}d` : "—"} title="Average days from applying to hearing back" />
            </div>
          )}

          {tracked.length > 0 && (
          <div className="mb-4 grid gap-3">
          <StageChips counts={counts} total={Object.values(counts).reduce((a, b) => a + b, 0)} value={stage} onChange={setStage} />
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative w-full sm:w-72">
              <svg viewBox="0 0 24 24" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-black/35" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                <circle cx="11" cy="11" r="7" />
                <path d="m20 20-3.5-3.5" />
              </svg>
              <input
                type="search"
                aria-label="Search"
                placeholder="Search company, role, location, notes"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className={`${inputClass} pl-9`}
              />
            </div>
            <select
              aria-label="Filter by role type"
              value={roleType}
              onChange={(e) => setRoleType(e.target.value as RoleType | "")}
              className={toolbarSelect}
            >
              <option value="">All role types</option>
              {ROLE_TYPES.map((r) => (
                <option key={r}>{r}</option>
              ))}
            </select>
            {hasActiveFilters(filters) && (
              <button type="button" onClick={clearFilters} className="rounded-full px-3 py-2 text-sm font-medium text-accent hover:underline">
                Clear filters
              </button>
            )}
            <div className="ml-auto inline-flex rounded-full bg-black/[0.05] p-1 text-sm" role="group" aria-label="View">
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
          <p className="sr-only" aria-live="polite">
            {filtered.length} of {tracked.length} shown
          </p>
          </div>
          )}

          {tracked.length === 0 ? (
            <EmptyState title="No applications yet">
              <p>Paste a job link above, or import a CSV from your old tracker.</p>
              <p className="mt-4">
                <Link href="/onboarding" className="font-medium text-accent hover:underline">
                  Walk through setup
                </Link>
              </p>
            </EmptyState>
          ) : filtered.length === 0 ? (
            <div className="rounded-[22px] bg-white p-10 text-center text-sm text-muted shadow-soft">
              <p>No applications match.</p>
              <button type="button" onClick={clearFilters} className="mt-2 font-medium text-accent hover:underline">
                Clear filters
              </button>
            </div>
          ) : view === "table" ? (
            <TrackerTable apps={filtered} onOpen={setEditing} onDelete={setDeleting} />
          ) : (
            <TrackerBoard apps={filtered} onOpen={setEditing} />
          )}

          <CheckedJobs
            apps={checkedOnly}
            onOpen={setEditing}
            onTrack={(a) => a.id !== undefined && setTriage(a.id, undefined)}
            onSkip={(a) => a.id !== undefined && setTriage(a.id, "skipped")}
            onRestore={(a) => a.id !== undefined && setTriage(a.id, "checked")}
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
          message={<DeleteJobMessage app={deleting} />}
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
