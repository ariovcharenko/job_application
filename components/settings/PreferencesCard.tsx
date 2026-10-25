"use client";

import { useState } from "react";
import { getPreferences, savePreferences } from "@/lib/db";
import { EXPERIENCE_LEVEL_OPTIONS } from "@/lib/eligibility/experience";
import { withLocations, withWorkModes } from "@/lib/eligibility/remoteSync";
import { MUST_HAVE_FILTERS } from "@/lib/intake/decision";
import { WORK_MODES, type WorkMode } from "@/lib/options";
import { ROLE_TYPES, type ExperienceLevel, type Preferences } from "@/lib/types";
import { activeGoal, withGoal, type GoalPeriod } from "@/lib/tracker/weeklyGoal";
import { useAutosave } from "@/lib/useAutosave";
import { Card, ChipSelect, Field, SelectField } from "@/components/ui";
import LocationPicker from "@/components/LocationPicker";

/** Every job family except the catch-all. */
const ROLE_CHOICES = ROLE_TYPES.filter((r) => r !== "Other");

export default function PreferencesCard() {
  const { draft: p, setDraft: setP, status } = useAutosave(getPreferences, savePreferences);
  // Remembers "Day"/"Week" while the number is still empty (nothing is stored until there's a number).
  const [goalPer, setGoalPer] = useState<GoalPeriod>("day");
  if (!p) return null;
  const goal = activeGoal(p);

  const update = (next: Preferences) => setP(next);

  const mustHaves = (
    <div>
      <h3 className="text-[15px] font-semibold">Must-haves</h3>
      <p className="mt-1 text-[13px] text-muted">Failing one means &quot;Don&apos;t apply&quot;.</p>
      <div className="mt-3 grid gap-2.5 sm:grid-cols-2">
        {MUST_HAVE_FILTERS.map((f) => (
          <label key={f.key} className="flex items-center gap-2.5 text-[15px]">
            <input
              type="checkbox"
              className="h-4 w-4"
              checked={p.mustHaves[f.key]}
              onChange={(e) => update({ ...p, mustHaves: { ...p.mustHaves, [f.key]: e.target.checked } })}
            />
            {f.label}
          </label>
        ))}
      </div>
    </div>
  );

  return (
    <Card title="Job preferences" hint="Every job you add is checked against these, for free." saveStatus={status}>
      <div className="grid gap-7">
        <div className="max-w-sm">
          <SelectField
            label="My experience level"
            value={p.experienceLevel}
            onChange={(v) => update({ ...p, experienceLevel: v as ExperienceLevel })}
            options={EXPERIENCE_LEVEL_OPTIONS}
          />
        </div>
        <ChipSelect
          label="Roles I'm looking for"
          hint="Never rules a job out."
          options={ROLE_CHOICES}
          value={p.targetRoles}
          onChange={(v) => update({ ...p, targetRoles: v })}
        />
        <LocationPicker
          label="My locations"
          hint="Hybrid and on-site jobs must be in one. Add Remote (US) for remote jobs."
          value={p.locations}
          onChange={(v) => update(withLocations(p, v))}
        />
        <ChipSelect
          label="Work styles I accept"
          options={WORK_MODES}
          value={p.workModes}
          onChange={(v) => update(withWorkModes(p, v as WorkMode[]))}
        />
        {mustHaves}
        <div className="max-w-sm">
          <div className="grid grid-cols-[1fr_auto] items-end gap-2">
            <Field
              label="Application goal (optional)"
              type="number"
              placeholder="Off"
              value={goal ? String(goal.count) : ""}
              onChange={(v) => update(withGoal(p, Number(v), goal?.per ?? goalPer))}
            />
            <SelectField
              label="Per"
              value={goal?.per ?? goalPer}
              onChange={(v) => {
                setGoalPer(v as GoalPeriod);
                if (goal) update(withGoal(p, goal.count, v as GoalPeriod));
              }}
              options={[
                { value: "day", label: "Day" },
                { value: "week", label: "Week" },
              ]}
            />
          </div>
          <p className="mt-1.5 text-[13px] text-muted">A reminder on the Tracker, never required. A week runs Monday to Sunday. Leave empty for no goal.</p>
        </div>
      </div>

    </Card>
  );
}
