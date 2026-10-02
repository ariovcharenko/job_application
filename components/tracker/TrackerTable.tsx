"use client";

import { useState } from "react";
import JobResumeDialog from "@/components/resumes/JobResumeDialog";
import { safeHttpUrl } from "@/lib/safeUrl";
import { changeStage } from "@/lib/tracker/repo";
import { needsFollowUp } from "@/lib/tracker/stage";
import { STAGES, type Application, type Stage } from "@/lib/types";
import { CompanyMark, STAGE_SELECT_CLASS, STAGE_STYLE } from "./StageBadge";

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

/** Below the md breakpoint each job is a stacked card instead of a table row. */
function MobileCards({ apps, onOpen, onDelete }: { apps: Application[]; onOpen: (a: Application) => void; onDelete: (a: Application) => void }) {
  return (
    <ul className="grid gap-3 md:hidden" aria-label="Applications">
      {apps.map((a) => {
        const place = [a.location, a.workMode && a.workMode !== "Unknown" ? a.workMode : ""].filter(Boolean).join(" · ");
        return (
          <li key={a.id} className={`rounded-[22px] bg-white p-4 shadow-soft ${a.stage === "Rejected" ? "text-muted" : ""}`}>
            <div className="flex items-start gap-3">
              <CompanyMark name={a.company} />
              <button
                type="button"
                onClick={() => onOpen(a)}
                className="min-w-0 flex-1 rounded-md text-left outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
              >
                <span className="block truncate font-medium">{a.company || "Company not set"}</span>
                <span className={`block text-[13px] leading-snug ${a.stage === "Rejected" ? "" : "text-ink"}`}>{a.role || "Role not set"}</span>
                {place && <span className="mt-0.5 block truncate text-xs text-muted">{place}</span>}
              </button>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 text-xs">
              <StageSelect app={a} />
              {needsFollowUp(a) && <span className="font-medium text-warn">Follow up</span>}
              {a.appliedDate && <span className="tabular-nums text-muted">Applied {shortDate(a.appliedDate)}</span>}
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

// Column widths for the fixed table layout. Position takes what's left. Location, Applied and Resume
// only appear from lg up, so the table fits its container at every width without a sideways scroll
// (below md each job is a card instead).
const COLUMNS: { label: string; width: string; className?: string }[] = [
  { label: "Company", width: "w-[28%] lg:w-[21%]" },
  { label: "Position", width: "" },
  { label: "Stage", width: "w-[168px]" },
  { label: "Location", width: "w-[13%]", className: "hidden lg:table-cell" },
  { label: "Applied", width: "w-[84px]", className: "hidden lg:table-cell" },
  { label: "Resume", width: "w-[76px]", className: "hidden lg:table-cell" },
  { label: "", width: "w-[44px]" },
];

const shortDate = (iso: string) => {
  const d = new Date(`${iso}T00:00:00`);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
};

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
      <div className="hidden rounded-[22px] bg-white shadow-soft md:block">
        <table className="w-full table-fixed text-left text-sm">
          <thead className="text-[12px] text-muted">
            <tr>
              {COLUMNS.map((c, i) => (
                <th
                  key={c.label || "actions"}
                  scope="col"
                  className={`sticky top-12 z-[1] border-b border-black/[0.06] bg-white/95 px-3 py-3 font-medium backdrop-blur ${c.width} ${c.className ?? ""} ${
                    i === 0 ? "rounded-tl-[22px]" : i === COLUMNS.length - 1 ? "rounded-tr-[22px]" : ""
                  }`}
                >
                  {c.label || <span className="sr-only">Actions</span>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="[&>tr:last-child>td:first-child]:rounded-bl-[22px] [&>tr:last-child>td:last-child]:rounded-br-[22px]">
            {apps.map((a) => (
              <tr
                key={a.id}
                onClick={() => onOpen(a)}
                className={`group cursor-pointer border-b border-black/[0.05] transition-colors last:border-0 hover:bg-paper ${a.stage === "Rejected" ? "text-muted" : ""}`}
              >
                <td className="px-3 py-3">
                  <div className="flex min-w-0 items-center gap-2.5">
                    <CompanyMark name={a.company} />
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onOpen(a);
                      }}
                      title={a.company || undefined}
                      className="min-w-0 truncate rounded-md text-left font-medium outline-none hover:text-accent focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
                    >
                      {a.company || "—"}
                      {!a.company && <span className="sr-only">Open {a.role || "job"}</span>}
                    </button>
                  </div>
                </td>
                <td className="px-3 py-3">
                  <span className={`line-clamp-2 leading-snug ${a.stage === "Rejected" ? "" : "text-ink"}`} title={a.role || undefined}>
                    {a.role || "—"}
                  </span>
                </td>
                <td className="px-3 py-3" onClick={(e) => e.stopPropagation()}>
                  <StageSelect app={a} />
                  {needsFollowUp(a) && <span className="mt-1 block text-xs font-medium text-warn">Follow up</span>}
                </td>
                <td className="hidden px-3 py-3 lg:table-cell">
                  <span className="block truncate" title={a.location || undefined}>
                    {a.location || "—"}
                  </span>
                  {a.workMode && a.workMode !== "Unknown" && <span className="block truncate text-xs text-muted">{a.workMode}</span>}
                </td>
                <td className="hidden whitespace-nowrap px-3 py-3 tabular-nums text-muted lg:table-cell" title={a.appliedDate || undefined}>
                  {a.appliedDate ? shortDate(a.appliedDate) : "—"}
                </td>
                <td className="hidden px-3 py-3 lg:table-cell" onClick={(e) => e.stopPropagation()}>
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
