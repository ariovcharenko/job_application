"use client";

import { useEffect, useState } from "react";
import { getProfile, saveProfile } from "@/lib/db";
import {
  DEGREE_TYPES,
  DISABILITY_OPTIONS,
  FIELD_OF_STUDY_SUGGESTIONS,
  GENDER_OPTIONS,
  RACE_OPTIONS,
  SALARY_SUGGESTIONS,
  VETERAN_OPTIONS,
  VISA_STATUSES,
} from "@/lib/options";
import { loadGeo, type GeoIndex } from "@/lib/geo/index";
import { searchPlaces } from "@/lib/geo/search";
import type { Profile } from "@/lib/types";
import { useAutosave } from "@/lib/useAutosave";
import { Card, Field, MonthYearField, SaveIndicator, SelectField, StartDateField } from "@/components/ui";

type TextKey = {
  [K in keyof Profile]: Profile[K] extends string ? (string extends Profile[K] ? K : never) : never;
}[keyof Profile];

const CONTACT: { key: TextKey; label: string; type?: string; suggestions?: string[] }[] = [
  { key: "fullName", label: "Full name" },
  { key: "email", label: "Email", type: "email" },
  { key: "phone", label: "Phone", type: "tel" },
  { key: "location", label: "Location (city, state)" },
  { key: "linkedin", label: "LinkedIn URL" },
  { key: "github", label: "GitHub URL" },
  { key: "portfolio", label: "Portfolio URL" },
];

const NOT_SET = { value: "", label: "Not set (field will be left blank)" };
const YES_NO = [NOT_SET, { value: "yes", label: "Yes" }, { value: "no", label: "No" }];
const choices = (values: string[]) => [NOT_SET, ...values.map((v) => ({ value: v, label: v }))];
// Keep a previously typed value selectable even if it is not in the standard list.
const withCurrent = (options: string[], current: string) =>
  current && !options.includes(current) ? [...options, current] : options;

const LEGAL_SELECTS: { key: TextKey; label: string; options: string[] }[] = [
  { key: "visaStatus", label: "Work authorization status", options: VISA_STATUSES },
  { key: "gender", label: "Gender (EEO)", options: GENDER_OPTIONS },
  { key: "race", label: "Race / ethnicity (EEO)", options: RACE_OPTIONS },
  { key: "veteran", label: "Veteran status (EEO)", options: VETERAN_OPTIONS },
  { key: "disability", label: "Disability status (EEO)", options: DISABILITY_OPTIONS },
];

export default function ProfileCard() {
  const { draft: p, setDraft: setP, status } = useAutosave(getProfile, saveProfile);
  // US place names for the location suggestions, loaded on demand (a separate chunk).
  const [geo, setGeo] = useState<GeoIndex | null>(null);
  useEffect(() => {
    let alive = true;
    void loadGeo().then((g) => alive && setGeo(g));
    return () => {
      alive = false;
    };
  }, []);
  if (!p) return null;

  // "Irv" -> "Irvine, CA", "Irving, TX"... Cities only: a resume header wants "City, ST".
  const locationSuggestions =
    geo && p.location.trim().length >= 2
      ? searchPlaces(p.location, geo, 8)
          .filter((s) => s.kind === "city")
          .map((s) => s.label)
          .filter((l) => l !== p.location)
      : [];

  const set = <K extends keyof Profile>(key: K, value: Profile[K]) => {
    setP({ ...p, [key]: value });
  };

  return (
    <Card title="Profile" hint="Your name, contact links and education go at the top of every tailored resume. Stays in this browser.">
      <div className="grid gap-4 sm:grid-cols-2">
        {CONTACT.map(({ key, label, type, suggestions }) => (
          <Field
            key={key}
            label={label}
            type={type}
            suggestions={key === "location" ? locationSuggestions : suggestions}
            value={p[key]}
            onChange={(v) => set(key, v)}
          />
        ))}
      </div>

      <h3 className="mt-6 text-sm font-semibold">Education</h3>
      <div className="mt-3 grid gap-4 sm:grid-cols-2">
        <Field label="School" value={p.school} onChange={(v) => set("school", v)} />
        <SelectField
          label="Degree type"
          value={p.degreeType}
          onChange={(v) => set("degreeType", v)}
          options={choices(withCurrent(DEGREE_TYPES, p.degreeType))}
        />
        <Field
          label="Major"
          placeholder="Pick a suggestion or type your own"
          suggestions={FIELD_OF_STUDY_SUGGESTIONS}
          value={p.major}
          onChange={(v) => set("major", v)}
        />
        <Field
          label="Minor (optional)"
          placeholder="Pick a suggestion or type your own"
          suggestions={FIELD_OF_STUDY_SUGGESTIONS}
          value={p.minor}
          onChange={(v) => set("minor", v)}
        />
        <MonthYearField label="Graduation" value={p.graduation} onChange={(v) => set("graduation", v)} />
        <Field label="GPA" placeholder="3.85" value={p.gpa} onChange={(v) => set("gpa", v)} />
      </div>

      <h3 className="mt-6 text-sm font-semibold">Job details</h3>
      <div className="mt-3 grid gap-4 sm:grid-cols-2">
        <Field
          label="Salary expectation"
          placeholder="Pick a range or type your own"
          suggestions={SALARY_SUGGESTIONS}
          value={p.salaryExpectation}
          onChange={(v) => set("salaryExpectation", v)}
        />
        <StartDateField label="Earliest start" value={p.earliestStart} onChange={(v) => set("earliestStart", v)} />
      </div>

      <h3 className="mt-6 text-sm font-semibold">Legal and identity answers</h3>
      <p className="mt-1 text-sm text-muted">
        Only what you choose here is ever used. The AI never guesses these. Anything left unset stays blank and is flagged for
        you.
      </p>
      <p className="mt-2 rounded-2xl bg-accent-soft px-4 py-3 text-sm leading-relaxed text-ink">
        <strong className="font-semibold">Why we ask about work authorization:</strong> many jobs can&apos;t sponsor a visa, and some
        require US citizenship or a clearance. Your answers decide whether a job passes the &quot;Works with my work authorization&quot;
        check. If you leave sponsorship blank, that check stays unclear instead of passing.
      </p>
      <div className="mt-3 grid gap-4 sm:grid-cols-2">
        <SelectField
          label="Authorized to work in the US?"
          value={p.authorizedToWorkUS}
          onChange={(v) => set("authorizedToWorkUS", v as Profile["authorizedToWorkUS"])}
          options={YES_NO}
        />
        <SelectField
          label="Will you require sponsorship?"
          value={p.requiresSponsorship}
          onChange={(v) => set("requiresSponsorship", v as Profile["requiresSponsorship"])}
          options={YES_NO}
        />
        <SelectField
          label="Willing to relocate?"
          value={p.willingToRelocate}
          onChange={(v) => set("willingToRelocate", v as Profile["willingToRelocate"])}
          options={YES_NO}
        />
        {LEGAL_SELECTS.map(({ key, label, options }) => (
          <SelectField
            key={key}
            label={label}
            value={p[key]}
            onChange={(v) => set(key, v)}
            options={choices(withCurrent(options, p[key]))}
          />
        ))}
      </div>

      <SaveIndicator status={status} />
    </Card>
  );
}
