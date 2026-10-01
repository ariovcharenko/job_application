"use client";

import { useState } from "react";
import { changeStage } from "@/lib/tracker/repo";
import { needsFollowUp } from "@/lib/tracker/stage";
import { STAGES, type Application, type Stage } from "@/lib/types";
import { CompanyMark, STAGE_SELECT_CLASS, STAGE_STYLE } from "./StageBadge";

export default function TrackerBoard({ apps, onOpen }: { apps: Application[]; onOpen: (a: Application) => void }) {
  const [over, setOver] = useState<Stage | null>(null);

  const drop = async (stage: Stage, e: React.DragEvent) => {
    e.preventDefault();
    setOver(null);
    const id = Number(e.dataTransfer.getData("text/plain"));
    const app = apps.find((a) => a.id === id);
    if (app && app.stage !== stage) await changeStage(app, stage);
  };

  return (
    <div className="flex snap-x snap-mandatory gap-3 overflow-x-auto overscroll-x-contain pb-2 md:snap-none md:gap-4" role="group" aria-label="Stages">
      {STAGES.map((stage) => {
        const items = apps.filter((a) => a.stage === stage);
        return (
          <section
            key={stage}
            aria-label={stage}
            onDragOver={(e) => {
              e.preventDefault();
              setOver(stage);
            }}
            onDragLeave={() => setOver((cur) => (cur === stage ? null : cur))}
            onDrop={(e) => drop(stage, e)}
            className={`w-[78vw] max-w-[260px] shrink-0 snap-start rounded-2xl border p-2.5 md:w-auto md:min-w-[190px] md:max-w-none md:flex-1 transition-colors ${over === stage ? "border-accent/40 bg-accent-soft/60" : "border-black/[0.06] bg-black/[0.025]"}`}
          >
            <h3 className="mb-2 flex items-center justify-between px-1 text-sm font-medium">
              <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${STAGE_STYLE[stage]}`}>{stage}</span>
              <span className="rounded-md bg-white px-1.5 text-xs font-medium tabular-nums text-muted shadow-soft">{items.length}</span>
            </h3>
            <div className="grid gap-2">
              {items.map((a) => (
                <article
                  key={a.id}
                  draggable
                  onDragStart={(e) => e.dataTransfer.setData("text/plain", String(a.id))}
                  onClick={() => onOpen(a)}
                  className="cursor-grab rounded-xl border border-black/[0.06] bg-white p-3 text-sm shadow-soft transition hover:-translate-y-px hover:shadow-lift active:cursor-grabbing"
                >
                  <div className="flex items-center gap-2">
                    <CompanyMark name={a.company} />
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onOpen(a);
                      }}
                      className="rounded-md text-left font-medium outline-none hover:text-accent focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
                    >
                      {a.company || "—"}
                      {!a.company && <span className="sr-only">Open {a.role || "job"}</span>}
                    </button>
                  </div>
                  <p className="mt-1.5 text-black/70">{a.role}</p>
                  {a.location && <p className="mt-1 text-xs text-muted">{a.location}</p>}
                  {a.appliedDate && <p className="text-xs text-muted">Applied {a.appliedDate}</p>}
                  {needsFollowUp(a) && <p className="mt-1 text-xs font-medium text-warn">Follow up</p>}
                  <select
                    aria-label="Move to stage"
                    value={a.stage}
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) => changeStage(a, e.target.value as Stage)}
                    className={`mt-2.5 ${STAGE_SELECT_CLASS} ${STAGE_STYLE[a.stage]}`}
                  >
                    {STAGES.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                </article>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
