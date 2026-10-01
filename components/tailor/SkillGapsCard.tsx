"use client";

import { useState } from "react";

/**
 * The job's skills that aren't on the page yet. Ones her master profile already has are one click
 * to add. Ones it doesn't are added only when she says she has them (decision #6: nothing
 * unverified goes on the page without her), optionally saved to her master profile too.
 */
export default function SkillGapsCard({
  total,
  onPage,
  inProfile,
  notInProfile,
  onAdd,
  disabled,
}: {
  total: number;
  onPage: number;
  /** Skills the job asks for that her master profile has but the page doesn't show. */
  inProfile: string[];
  /** Skills the job asks for that aren't in her master profile at all. */
  notInProfile: string[];
  onAdd: (skills: string[], opts: { confirmedByHer: boolean; saveToProfile: boolean }) => void;
  disabled?: boolean;
}) {
  const [saveToProfile, setSaveToProfile] = useState(true);
  if (total === 0) return null;

  return (
    <section className="rounded-2xl border border-black/[0.08] bg-white p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-[15px] font-semibold tracking-display">Skills this job asks for</h3>
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

      {inProfile.length > 0 && (
        <div className="mt-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-[13px] font-medium">In your profile, not on the page</p>
            {inProfile.length > 1 && (
              <button
                type="button"
                disabled={disabled}
                onClick={() => onAdd(inProfile, { confirmedByHer: false, saveToProfile: false })}
                className="text-[13px] font-medium text-accent hover:underline disabled:opacity-40"
              >
                Add all
              </button>
            )}
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            {inProfile.map((s) => (
              <button
                key={s}
                type="button"
                disabled={disabled}
                onClick={() => onAdd([s], { confirmedByHer: false, saveToProfile: false })}
                className="inline-flex items-center gap-1 rounded-full border border-black/[0.1] px-3 py-1 text-[13px] transition hover:border-accent hover:text-accent disabled:opacity-40"
              >
                <span aria-hidden="true">+</span> {s}
              </button>
            ))}
          </div>
        </div>
      )}

      {notInProfile.length > 0 && (
        <div className="mt-5">
          <p className="text-[13px] font-medium">Not in Your experience</p>
          <p className="mt-0.5 text-xs text-muted">Add one only if you really have it. It goes in your skills section.</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {notInProfile.map((s) => (
              <span key={s} className="inline-flex items-center gap-2 rounded-full border border-dashed border-black/20 py-1 pl-3 pr-1 text-[13px] text-muted">
                {s}
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => onAdd([s], { confirmedByHer: true, saveToProfile })}
                  className="rounded-full bg-black/[0.05] px-2.5 py-0.5 text-xs font-medium text-ink transition hover:bg-accent-soft hover:text-accent-deep disabled:opacity-40"
                >
                  I have this
                </button>
              </span>
            ))}
          </div>
          <label className="mt-3 flex items-center gap-2 text-xs text-muted">
            <input type="checkbox" checked={saveToProfile} onChange={(e) => setSaveToProfile(e.target.checked)} />
            Also save it to Your experience, so future resumes can use it
          </label>
        </div>
      )}

      {inProfile.length === 0 && notInProfile.length === 0 && (
        <p className="mt-3 text-[13px] text-muted">Every skill this job asks for is on the page.</p>
      )}
      <p className="mt-4 text-xs text-muted">
        To mention a skill inside a bullet, select that bullet on the page and say how you used it.
      </p>
    </section>
  );
}
