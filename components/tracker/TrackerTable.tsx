"use client";

import { useState } from "react";
import { verdictFor } from "@/lib/intake/decision";
import { hasIncompletePosting, readBreakdown } from "@/lib/intake/stored";
import JobResumeDialog from "@/components/resumes/JobResumeDialog";
import { safeHttpUrl } from "@/lib/safeUrl";
import { changeStage } from "@/lib/tracker/repo";
import { needsFollowUp } from "@/lib/tracker/stage";
import { STAGES, type Application, type Stage } from "@/lib/types";
import { CompanyMark, FitPill, STAGE_SELECT_CLASS, STAGE_STYLE } from "./StageBadge";

const link = "font-medium text-accent hover:underline underline-offset-2";

function ExtLink({ href, children }: { href: string; children: React.ReactNode }) {
  const safe = safeHttpUrl(href);
  if (!safe) return <>{children}</>;
  return (
    <a href={safe} target="_blank" rel="noopener noreferrer" className={link} onClick={(e) => e.stopPropagation()}>
      {children}
    </a>
  );
}

/** Skills-match % when the job passes her must-haves, "Don't apply" when it fails one; older rows show the old fit score. */
function MatchCell({ app }: { app: Application }) {
  const b = readBreakdown(app);
  if (b?.decision && hasIncompletePosting(app)) {
    return (
      <span className="whitespace-nowrap rounded-full bg-warn-soft px-2.5 py-1 text-xs font-medium text-warn" title="The saved text isn't the job description. Open the job to paste it and re-check.">
        Incomplete
      </span>
    );
  }
  if (b?.decision) {
    if (!b.decision.canApply) {
      return <span className="whitespace-nowrap rounded-full bg-black/[0.05] px-2.5 py-1 text-xs font-medium text-muted">Don&apos;t apply</span>;
    }
    const pct = b.skills?.percent ?? null;
    const strong = verdictFor(b.decision, pct) === "apply";
    return (
      <span
        className={`whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-semibold tabular-nums ${strong ? "bg-accent-soft text-accent-deep" : "bg-black/[0.05] text-muted"}`}
        title={strong ? "Apply" : "Weak match"}
      >
        {pct === null ? "Apply" : `${pct}%`}
        {!strong && <span className="font-normal"> · weak</span>}
      </span>
    );
  }
  return app.fitScore != null ? <FitPill score={app.fitScore} /> : null;
}

function StageSelect({ app }: { app: Application }) {
  return (
    <select
      aria-label={`Stage for ${app.company || app.role}`}
      value={app.stage}
      onChange={(e) => changeStage(app, e.target.value as Stage)}
      className={`${STAGE_SELECT_CLASS} ${STAGE_STYLE[app.stage]}`}
    >
      {STAGES.map((s) => (
        <option key={s} value={s}>
          {s}
        </option>
      ))}
    </select>
  );
}

function ResumeLink({ app }: { app: Application }) {
  const [open, setOpen] = useState(false);
  if (app.tailoredResumeId !== undefined) {
    return (
      <>
        <button
          type="button"
          className={`${link} whitespace-nowrap`}
          onClick={(e) => {
            e.stopPropagation();
            setOpen(true);
          }}
          title="Preview the resume for this job"
        >
          Preview
        </button>
        {open && <JobResumeDialog app={app} onClose={() => setOpen(false)} />}
      </>
    );
  }
  return app.tailoredUrl ? <ExtLink href={app.tailoredUrl}>Open</ExtLink> : null;
}

function DeleteButton({ app, onDelete, alwaysVisible = false }: { app: Application; onDelete: (a: Application) => void; alwaysVisible?: boolean }) {
  return (
    <button
      type="button"
      onClick={() => onDelete(app)}
      aria-label={`Delete ${app.company || app.role || "job"}`}
      title="Delete job"
      className={`rounded-full p-2 text-muted transition hover:bg-bad-soft hover:text-bad focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-accent/25 ${
        alwaysVisible ? "" : "opacity-0 focus:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100"
      }`}
    >
      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3" />
      </svg>
    </button>
  );
}

/** Below the sm breakpoint each job is a stacked card instead of a 1000px-wide table row. */
function MobileCards({ apps, onOpen, onDelete }: { apps: Application[]; onOpen: (a: Application) => void; onDelete: (a: Application) => void }) {
  return (
    <ul className="grid gap-3 sm:hidden" aria-label="Applications">
      {apps.map((a) => {
        const place = [a.location, a.workMode && a.workMode !== "Unknown" ? a.workMode : ""].filter(Boolean).join(" · ");
        return (
          <li key={a.id} className="rounded-[22px] bg-white p-4 shadow-soft">
            <div className="flex items-start gap-3">
              <CompanyMark name={a.company} />
              <button
                type="button"
                onClick={() => onOpen(a)}
                className="min-w-0 flex-1 rounded-md text-left outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
              >
                <span className="block truncate font-medium">{a.company || "Company not set"}</span>
                <span className="block text-[13px] leading-snug text-ink">{a.role || "Role not set"}</span>
                {place && <span className="mt-0.5 block truncate text-xs text-muted">{place}</span>}
              </button>
              <MatchCell app={a} />
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 text-xs">
              <StageSelect app={a} />
              {needsFollowUp(a) && <span className="font-medium text-warn">Follow up</span>}
              {a.appliedDate && <span className="tabular-nums text-muted">Applied {a.appliedDate}</span>}
              <span className="ml-auto flex items-center gap-1">
                <span className="text-sm">
                  <ResumeLink app={a} />
                </span>
                <DeleteButton app={a} onDelete={onDelete} alwaysVisible />
              </span>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

export default function TrackerTable({
  apps,
  onOpen,
  onDelete,
}: {
  apps: Application[];
  onOpen: (a: Application) => void;
  onDelete: (a: Application) => void;
}) {
  if (apps.length === 0) {
    return <p className="rounded-[22px] bg-white p-10 text-center text-sm text-muted shadow-soft">No applications match these filters.</p>;
  }
  return (
    <>
      <MobileCards apps={apps} onOpen={onOpen} onDelete={onDelete} />
      <div className="hidden overflow-x-auto rounded-[22px] bg-white shadow-soft sm:block">
        <table className="w-full min-w-[1000px] text-left text-sm">
          <thead className="border-b border-black/[0.06] text-[12px] text-muted">
            <tr>
              {["Company", "Position", "Match", "Stage", "Location", "Applied", "Resume", ""].map((h) => (
                <th key={h || "actions"} className="px-4 py-3.5 font-medium">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {apps.map((a) => (
              <tr key={a.id} onClick={() => onOpen(a)} className="group cursor-pointer border-b border-black/[0.05] transition-colors last:border-0 hover:bg-paper">
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2.5">
                    <CompanyMark name={a.company} />
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onOpen(a);
                      }}
                      className="whitespace-nowrap rounded-md text-left font-medium outline-none hover:text-accent focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
                    >
                      {a.company || "—"}
                      {!a.company && <span className="sr-only">Open {a.role || "job"}</span>}
                    </button>
                  </div>
                </td>
                <td className="min-w-[180px] px-4 py-3 text-ink">{a.role || "—"}</td>
                <td className="whitespace-nowrap px-4 py-3">
                  <MatchCell app={a} />
                </td>
                <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                  <StageSelect app={a} />
                  {needsFollowUp(a) && <span className="ml-2 text-xs font-medium text-warn">Follow up</span>}
                </td>
                <td className="max-w-[200px] px-4 py-3">
                  <span className="line-clamp-1">{a.location || "—"}</span>
                  {a.workMode && a.workMode !== "Unknown" && <span className="block text-xs text-muted">{a.workMode}</span>}
                </td>
                <td className="whitespace-nowrap px-4 py-3 tabular-nums text-black/70">{a.appliedDate}</td>
                <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                  <ResumeLink app={a} />
                </td>
                <td className="px-2 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                  <DeleteButton app={a} onDelete={onDelete} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
