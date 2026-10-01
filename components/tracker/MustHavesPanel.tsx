"use client";

import { useEffect } from "react";
import { getPreferences, savePreferences } from "@/lib/db";
import { EXPERIENCE_LEVEL_OPTIONS } from "@/lib/eligibility/experience";
import { withLocations, withWorkModes } from "@/lib/eligibility/remoteSync";
import { MUST_HAVE_FILTERS } from "@/lib/intake/decision";
import { WORK_MODES, type WorkMode } from "@/lib/options";
import type { ExperienceLevel, Preferences } from "@/lib/types";
import { useAutosave } from "@/lib/useAutosave";
import { ChipSelect, SelectField } from "@/components/ui";
import LocationPicker from "@/components/LocationPicker";

/**
 * Her must-have filters, editable right where she analyzes a job. Saved to Preferences (same
 * record as Settings), and reported up so the job's verdict updates instantly, with no AI call.
 */
export default function MustHavesPanel({ onChange }: { onChange: (prefs: Preferences) => void }) {
  const { draft: p, setDraft } = useAutosave(getPreferences, savePreferences);
  useEffect(() => {
    if (p) onChange(p);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p]);
  if (!p) return null;

  const on = MUST_HAVE_FILTERS.filter((f) => p.mustHaves[f.key]).length;

  return (
    <details className="group rounded-2xl bg-paper p-4">
      <summary className="flex cursor-pointer list-none items-center justify-between rounded-lg text-sm font-medium focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-accent/25">
        <span>
          My must-haves <span className="font-normal text-muted">{on} of {MUST_HAVE_FILTERS.length} on</span>
        </span>
        <span className="text-xs text-muted group-open:hidden">Edit</span>
      </summary>
      <p className="mt-2 text-xs text-muted">Failing one means &quot;Don&apos;t apply&quot;. Changes save and re-check for free.</p>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        {MUST_HAVE_FILTERS.map((f) => (
          <label key={f.key} className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-black/30"
              checked={p.mustHaves[f.key]}
              onChange={(e) => setDraft({ ...p, mustHaves: { ...p.mustHaves, [f.key]: e.target.checked } })}
            />
            {f.label}
          </label>
        ))}
      </div>
      {(p.mustHaves.experience || p.mustHaves.location) && (
        <div className="mt-4 grid gap-4">
          {p.mustHaves.experience && (
            <div className="max-w-sm">
              <SelectField
                label="My experience level"
                value={p.experienceLevel}
                onChange={(v) => setDraft({ ...p, experienceLevel: v as ExperienceLevel })}
                options={EXPERIENCE_LEVEL_OPTIONS}
              />
            </div>
          )}
          {p.mustHaves.location && (
            <>
              <LocationPicker label="My locations" value={p.locations} onChange={(v) => setDraft(withLocations(p, v))} />
              <ChipSelect label="Work styles I accept" options={WORK_MODES} value={p.workModes} onChange={(v) => setDraft(withWorkModes(p, v as WorkMode[]))} />
            </>
          )}
        </div>
      )}
    </details>
  );
}
