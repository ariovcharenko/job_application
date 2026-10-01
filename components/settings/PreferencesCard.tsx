"use client";

import { getPreferences, savePreferences } from "@/lib/db";
import { EXPERIENCE_LEVEL_OPTIONS } from "@/lib/eligibility/experience";
import { withLocations, withWorkModes } from "@/lib/eligibility/remoteSync";
import { FEATURES } from "@/lib/features";
import { MUST_HAVE_FILTERS } from "@/lib/intake/decision";
import { SENIORITY_OPTIONS, WORK_MODES, type WorkMode } from "@/lib/options";
import { ROLE_TYPES, type ExperienceLevel, type Preferences, type ScoreWeights } from "@/lib/types";
import { useAutosave } from "@/lib/useAutosave";
import { Card, ChipSelect, Field, SaveIndicator, SelectField } from "@/components/ui";
import LocationPicker from "@/components/LocationPicker";

const WEIGHT_LABELS: [keyof ScoreWeights, string][] = [
  ["sponsorship", "Work authorization fit"],
  ["location", "Location / remote"],
  ["match", "Role and skills match"],
  ["other", "Company, pay, other"],
  ["freshness", "Freshness"],
];

const DEAL_BREAKERS: [keyof Preferences["dealBreakers"], string][] = [
  ["noSponsorship", 'Says "no sponsorship"'],
  ["citizenshipRequired", "Requires US citizenship"],
  ["clearanceRequired", "Requires a security clearance"],
  ["locationOutsideTargets", "On-site or hybrid outside my locations"],
];

/** Every job family except the catch-all. */
const ROLE_CHOICES = ROLE_TYPES.filter((r) => r !== "Other");

const toList = (s: string) =>
  s
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);

export default function PreferencesCard() {
  const { draft: p, setDraft: setP, status } = useAutosave(getPreferences, savePreferences);
  if (!p) return null;

  const update = (next: Preferences) => setP(next);
  const total = Object.values(p.weights).reduce((a, b) => a + b, 0);

  const mustHaves = (
    <div>
      <h3 className="text-[15px] font-semibold">Must-haves</h3>
      <p className="mt-1 text-[13px] text-muted">A job that fails any of these is marked &quot;Don&apos;t apply&quot;. You can also change them when you add a job.</p>
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
    <Card title="Job preferences" hint="What a job needs for you to apply. Every job you add is checked against these, for free.">
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
          hint="Jobs outside these get a gentle note. They never rule a job out."
          options={ROLE_CHOICES}
          value={p.targetRoles}
          onChange={(v) => update({ ...p, targetRoles: v })}
        />
        <LocationPicker
          label="My locations"
          hint="Hybrid and on-site jobs must be in one of these. Add Remote (US) to accept remote jobs."
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
      </div>

      {FEATURES.jobFeed && (
        <div className="mt-8 grid gap-6 border-t border-black/[0.06] pt-6">
          <p className="text-[13px] text-muted">Used by the job feed&apos;s search and ranking.</p>
          <ChipSelect label="Seniority" options={SENIORITY_OPTIONS} value={p.seniority} onChange={(v) => update({ ...p, seniority: v })} />
          <Field
            label="Keywords (comma-separated)"
            placeholder="React, TypeScript, Python"
            value={p.keywords.join(", ")}
            onChange={(v) => update({ ...p, keywords: toList(v) })}
          />
          <ChipSelect
            label="Companies the feed watches"
            options={p.companyWatchlist}
            value={p.companyWatchlist}
            onChange={(v) => update({ ...p, companyWatchlist: v })}
            allowCustom
          />
          <div>
            <h3 className="text-sm font-semibold">Ranking weights</h3>
            <div className="mt-3 grid gap-4 sm:grid-cols-3">
              {WEIGHT_LABELS.map(([key, label]) => (
                <Field
                  key={key}
                  label={label}
                  type="number"
                  value={String(p.weights[key])}
                  onChange={(v) => update({ ...p, weights: { ...p.weights, [key]: Math.max(0, Number(v) || 0) } })}
                />
              ))}
            </div>
            <p className={`mt-2 text-sm ${total === 100 ? "text-muted" : "text-warn"}`}>Weights total {total}. They work best when they add up to 100.</p>
          </div>
          <div className="max-w-xs">
            <Field
              label="Apply threshold (ranking score)"
              type="number"
              value={String(p.applyThreshold)}
              onChange={(v) => update({ ...p, applyThreshold: Math.min(100, Math.max(0, Number(v) || 0)) })}
            />
          </div>
          <div>
            <h3 className="text-sm font-semibold">Deal-breakers (lower the ranking)</h3>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              {DEAL_BREAKERS.map(([key, label]) => (
                <label key={key} className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={p.dealBreakers[key]} onChange={(e) => update({ ...p, dealBreakers: { ...p.dealBreakers, [key]: e.target.checked } })} />
                  {label}
                </label>
              ))}
            </div>
          </div>
        </div>
      )}

      <SaveIndicator status={status} />
    </Card>
  );
}
