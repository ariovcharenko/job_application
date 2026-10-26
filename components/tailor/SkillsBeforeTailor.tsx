"use client";

import { compactInputClass, inputClass } from "@/components/ui";
import type { PlaceChoice, PreTailorGap, SkillAnswers } from "@/lib/resume/gaps";

const SKILLS_ONLY = "";

/**
 * Optional, next to the Tailor button: the job's skills her experience doesn't show. Ticking one
 * (and where she used it) lets the one tailoring call write it in, instead of a second update after
 * the fact. Nothing has to be answered: "Tailor resume" works with nothing ticked.
 */
export default function SkillsBeforeTailor({
  gaps,
  places,
  answers,
  onChange,
  disabled,
}: {
  gaps: PreTailorGap[];
  places: PlaceChoice[];
  answers: SkillAnswers;
  onChange: (a: SkillAnswers) => void;
  disabled?: boolean;
}) {
  const set = <K extends keyof SkillAnswers>(k: K, skill: string, v: SkillAnswers[K][string]) =>
    onChange({ ...answers, [k]: { ...answers[k], [skill]: v } });

  return (
    <section className="mb-4" aria-labelledby="skills-before-heading">
      <h3 id="skills-before-heading" className="text-[15px] font-semibold tracking-display">
        Do you have any of these? <span className="font-normal text-muted">(optional)</span>
      </h3>
      <p className="mt-0.5 text-[13px] text-muted">The job asks for them and your experience doesn&apos;t show them. Tick only what&apos;s true, and they go into this resume.</p>
      <ul className="mt-3 grid gap-2">
        {gaps.map((g) => (
          <li key={g.skill} className="rounded-xl bg-white px-3 py-2">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <label className="flex min-w-0 flex-1 items-center gap-2 text-[14px]">
                <input type="checkbox" checked={!!answers.have[g.skill]} onChange={(e) => set("have", g.skill, e.target.checked)} disabled={disabled} />
                <span className="font-medium">{g.skill}</span>
                <span className="text-xs text-muted">{g.required ? "Required" : "Nice to have"}</span>
              </label>
              {answers.have[g.skill] && (
                <select
                  value={answers.place[g.skill] ?? SKILLS_ONLY}
                  onChange={(e) => set("place", g.skill, e.target.value)}
                  aria-label={`Where you used ${g.skill}`}
                  className={`${compactInputClass} min-w-0 max-w-full`}
                  disabled={disabled}
                >
                  <option value={SKILLS_ONLY}>Skills section only</option>
                  {places.map((p) => (
                    <option key={p.key} value={p.key}>
                      Used in {p.label}
                    </option>
                  ))}
                </select>
              )}
            </div>
            {answers.have[g.skill] && (answers.place[g.skill] ?? SKILLS_ONLY) !== SKILLS_ONLY && (
              <input
                value={answers.how[g.skill] ?? ""}
                onChange={(e) => set("how", g.skill, e.target.value)}
                placeholder="How you used it (optional)"
                aria-label={`How you used ${g.skill} (optional)`}
                className={`${inputClass} mt-2 py-1.5 text-[13px] sm:text-[13px]`}
                disabled={disabled}
              />
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
