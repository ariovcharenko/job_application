"use client";

import { useState } from "react";
import { Button, inputClass } from "@/components/ui";

/** A role or project on the page she can place a skill in. */
export interface PlaceOption {
  key: string;
  label: string;
}

export interface GapSkill {
  skill: string;
  /** In her experience already (skills list, a bullet, or a synonym). False = she must confirm it. */
  inProfile: boolean;
}

/** A skill she placed in a role, waiting for the one call that writes it into that role's bullets. */
export interface PendingPlacement {
  skill: string;
  placeLabel: string;
}

const SKILLS_ONLY = "";

/**
 * "Job skills not on your resume", after tailoring. Skills she has but the page doesn't show get a
 * row with where to put them: "Skills section only" adds it right away (free); a role or project
 * adds it to Skills too and queues one rewrite of that role's bullets, and "Apply" sends every
 * queued placement in a single call. Skills her experience doesn't have were already asked about
 * before tailoring (PreTailorCard), so they're only listed quietly; she can still open them and
 * add one (her click is the confirmation, decision #6, saved so she isn't asked again).
 */
export default function SkillGapsCard({
  total,
  onPage,
  gaps,
  places,
  pending,
  onAdd,
  onApply,
  onCancel,
  applyCost,
  disabled,
}: {
  total: number;
  onPage: number;
  gaps: GapSkill[];
  places: PlaceOption[];
  pending: PendingPlacement[];
  /** `place`: a PlaceOption key, or "" for the skills section only. `how`: her optional note. */
  onAdd: (skill: string, place: string, how: string) => void;
  onApply: () => void;
  onCancel: (index: number) => void;
  applyCost: string;
  disabled?: boolean;
}) {
  const [place, setPlace] = useState<Record<string, string>>({});
  const [how, setHow] = useState<Record<string, string>>({});
  const [openQuiet, setOpenQuiet] = useState(false);
  if (total === 0) return null;
  const quiet = gaps.filter((g) => !g.inProfile);
  const rows = openQuiet ? gaps : gaps.filter((g) => g.inProfile);

  return (
    <section className="rounded-2xl border border-black/[0.08] bg-white p-5" aria-labelledby="gaps-heading">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 id="gaps-heading" className="text-[15px] font-semibold tracking-display">
          Job skills not on your resume
        </h3>
        <p className="text-[13px] text-muted">
          <span className="font-semibold tabular-nums text-ink">
            {onPage} of {total}
          </span>{" "}
          on the page
        </p>
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-black/[0.06]">
        <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${Math.round((onPage / total) * 100)}%` }} />
      </div>

      {gaps.length === 0 && <p className="mt-3 text-[13px] text-muted">Every skill this job asks for is on the page.</p>}
      {quiet.length > 0 && !openQuiet && (
        <p className="mt-3 text-[13px] text-muted">
          Not on your resume: {quiet.map((g) => g.skill).join(", ")}.{" "}
          <button type="button" onClick={() => setOpenQuiet(true)} className="font-medium text-accent hover:underline" disabled={disabled}>
            I have one of these
          </button>
        </p>
      )}
      {rows.length > 0 && (
        <ul className="mt-4 grid gap-3">
          {rows.map(({ skill, inProfile }) => {
            const where = place[skill] ?? SKILLS_ONLY;
            return (
              <li key={skill} className="grid gap-2 rounded-xl bg-paper p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[14px] font-medium">{skill}</span>
                  {!inProfile && <span className="rounded-full border border-dashed border-black/20 px-2 py-0.5 text-xs text-muted">Not in your experience</span>}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <label className="sr-only" htmlFor={`place-${skill}`}>
                    Where to add {skill}
                  </label>
                  <select
                    id={`place-${skill}`}
                    value={where}
                    onChange={(e) => setPlace((p) => ({ ...p, [skill]: e.target.value }))}
                    className="min-w-0 flex-1 rounded-xl border border-black/[0.1] bg-white px-3 py-2 text-[13px] outline-none focus:border-accent focus:ring-4 focus:ring-accent/15"
                  >
                    <option value={SKILLS_ONLY}>Skills section only</option>
                    {places.map((p) => (
                      <option key={p.key} value={p.key}>
                        Skills and {p.label}
                      </option>
                    ))}
                  </select>
                  <Button
                    variant={inProfile ? "primary" : "secondary"}
                    disabled={disabled}
                    onClick={() => {
                      onAdd(skill, where, how[skill] ?? "");
                      setHow((h) => ({ ...h, [skill]: "" }));
                    }}
                  >
                    {inProfile ? "Add" : "I have it, add"}
                  </Button>
                </div>
                {where !== SKILLS_ONLY && (
                  <input
                    value={how[skill] ?? ""}
                    onChange={(e) => setHow((h) => ({ ...h, [skill]: e.target.value }))}
                    placeholder="How you used it (optional), e.g. wrote the payment retries in it"
                    aria-label={`How you used ${skill} (optional)`}
                    className={`${inputClass} py-2 text-[13px] sm:text-[13px]`}
                  />
                )}
              </li>
            );
          })}
        </ul>
      )}
      {openQuiet && quiet.length > 0 && (
        <p className="mt-3 text-xs text-muted">Add a skill only if you really have it. It&apos;s saved to Your experience, so you won&apos;t be asked again.</p>
      )}

      {pending.length > 0 && (
        <div className="mt-4 rounded-xl bg-accent-soft/50 p-3">
          <p className="text-[13px] font-medium">Waiting to be written into your bullets</p>
          <ul className="mt-1 grid gap-1 text-[13px]">
            {pending.map((p, i) => (
              <li key={`${p.skill}-${p.placeLabel}`} className="flex items-center justify-between gap-2">
                <span>
                  {p.skill} in {p.placeLabel}
                </span>
                <button type="button" onClick={() => onCancel(i)} className="text-xs text-muted hover:text-bad" disabled={disabled}>
                  Cancel
                </button>
              </li>
            ))}
          </ul>
          <div className="mt-2 flex justify-end">
            <Button onClick={onApply} disabled={disabled}>
              Apply {pending.length} change{pending.length === 1 ? "" : "s"} ({applyCost})
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}
