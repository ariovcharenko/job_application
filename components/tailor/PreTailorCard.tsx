"use client";

import { useState } from "react";
import { Button, inputClass } from "@/components/ui";
import type { ConfirmedSkill, PlaceChoice, PreTailorGap } from "@/lib/resume/gaps";

const SKILLS_ONLY = "";

/**
 * Asked before tailoring: the job's skills that aren't in her experience. She ticks the ones she
 * has, optionally where she used each, and the one tailoring call uses her answers. Nothing is
 * added without her tick (decision #6).
 */
export default function PreTailorCard({
  gaps,
  places,
  cost,
  onTailor,
  onSkip,
  disabled,
}: {
  gaps: PreTailorGap[];
  places: PlaceChoice[];
  cost: string;
  onTailor: (confirmed: ConfirmedSkill[]) => void;
  onSkip: () => void;
  disabled?: boolean;
}) {
  const [have, setHave] = useState<Record<string, boolean>>({});
  const [place, setPlace] = useState<Record<string, string>>({});
  const [how, setHow] = useState<Record<string, string>>({});
  const ticked = gaps.filter((g) => have[g.skill]);

  const confirm = () =>
    onTailor(
      ticked.map((g) => ({
        skill: g.skill,
        place: places.find((p) => p.key === (place[g.skill] ?? SKILLS_ONLY)) ?? null,
        how: how[g.skill] ?? "",
      })),
    );

  return (
    <section className="rounded-2xl border border-black/[0.08] bg-white p-5" aria-labelledby="pretailor-heading">
      <h3 id="pretailor-heading" className="text-[15px] font-semibold tracking-display">
        Before tailoring: do you have any of these?
      </h3>
      <p className="mt-0.5 text-[13px] text-muted">The job asks for them and Your experience doesn&apos;t show them. Tick only what&apos;s true.</p>
      <ul className="mt-3 grid gap-2">
        {gaps.map((g) => (
          <li key={g.skill} className="rounded-xl bg-paper px-3 py-2">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <label className="flex min-w-0 flex-1 items-center gap-2 text-[14px]">
                <input type="checkbox" checked={!!have[g.skill]} onChange={(e) => setHave((h) => ({ ...h, [g.skill]: e.target.checked }))} disabled={disabled} />
                <span className="font-medium">{g.skill}</span>
                <span className="text-xs text-muted">{g.required ? "Required" : "Nice to have"}</span>
              </label>
              {have[g.skill] && (
                <select
                  value={place[g.skill] ?? SKILLS_ONLY}
                  onChange={(e) => setPlace((p) => ({ ...p, [g.skill]: e.target.value }))}
                  aria-label={`Where you used ${g.skill}`}
                  className="min-w-0 rounded-xl border border-black/[0.1] bg-white px-3 py-1.5 text-[13px] outline-none focus:border-accent focus:ring-4 focus:ring-accent/15"
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
            {have[g.skill] && (place[g.skill] ?? SKILLS_ONLY) !== SKILLS_ONLY && (
              <input
                value={how[g.skill] ?? ""}
                onChange={(e) => setHow((h) => ({ ...h, [g.skill]: e.target.value }))}
                placeholder="How you used it (optional)"
                aria-label={`How you used ${g.skill} (optional)`}
                className={`${inputClass} mt-2 py-1.5 text-[13px] sm:text-[13px]`}
              />
            )}
          </li>
        ))}
      </ul>
      <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
        <Button variant="secondary" onClick={onSkip} disabled={disabled}>
          Skip
        </Button>
        <Button onClick={confirm} disabled={disabled}>
          Tailor resume ({cost})
        </Button>
      </div>
    </section>
  );
}
