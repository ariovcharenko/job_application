"use client";

import { useLiveQuery } from "dexie-react-hooks";
import Link from "next/link";
import { useEffect, useState } from "react";
import ApiKeyCard from "@/components/settings/ApiKeyCard";
import MasterProfileCard from "@/components/settings/MasterProfileCard";
import PreferencesCard from "@/components/settings/PreferencesCard";
import ProfileCard from "@/components/settings/ProfileCard";
import ReadinessStrip from "@/components/ReadinessStrip";
import { primaryLinkClass, secondaryLinkClass } from "@/components/SetupCard";
import { Button, ExternalLinkIcon } from "@/components/ui";
import { getMasterProfile, getPreferences, getProfile, getSettings, savePreferences } from "@/lib/db";
import { choiceLabel, metroChoice } from "@/lib/geo/choices";
import { loadGeo, type GeoIndex } from "@/lib/geo/index";
import { searchPlaces } from "@/lib/geo/search";
import { readiness } from "@/lib/readiness";

// Ordered by what the core flow needs: a key to read jobs, her experience to match and tailor
// against, then who she is (work authorization) and what she's looking for.
const STEPS = [
  { title: "Welcome", key: "welcome", lead: "" },
  {
    title: "Connect Claude",
    key: "key",
    lead: "You pay Anthropic only for what you use: about 1 to 2¢ to check a job, about 5¢ to tailor a resume.",
  },
  {
    title: "Your experience",
    key: "master",
    lead: "Import your resume or paste everything you've done. Jobs are matched against it, and resumes are written only from it.",
  },
  {
    title: "About you",
    key: "profile",
    lead: "Your name and links head every tailored resume. Work authorization answers decide which jobs pass, and are never guessed.",
  },
  {
    title: "What you're looking for",
    key: "preferences",
    lead: "Every job you add is checked against these, for free.",
  },
  { title: "You're set", key: "done", lead: "" },
] as const;

const STEP_STORAGE = "job-copilot:onboarding-step";

function loadStep(): number {
  try {
    const n = Number(window.localStorage.getItem(STEP_STORAGE));
    return Number.isInteger(n) && n >= 0 && n < STEPS.length ? n : 0;
  } catch {
    return 0;
  }
}

function saveStep(n: number) {
  try {
    window.localStorage.setItem(STEP_STORAGE, String(n));
  } catch {
    // Storage blocked (private window, site data off): the wizard still works, it just won't resume.
  }
}

/** Location choices suggested from the Profile's "Location (city, state)": the city's metro, then the city. */
function suggestedLocations(profileLocation: string, current: string[], geo: GeoIndex): string[] {
  const text = profileLocation.trim();
  if (!text) return [];
  const top = searchPlaces(text, geo, 1)[0];
  if (!top) return [];
  const ids: string[] = [];
  if (top.kind === "city") {
    const metro = geo.cityBySlug.get(top.id.slice("city:".length))?.metro;
    if (metro) ids.push(metroChoice(metro));
  }
  ids.push(top.id);
  return ids.filter((id) => !current.includes(id));
}

/** S5: offer her Profile's city (or its metro) as a location choice, one click. */
function LocationSuggestion({ onAdded }: { onAdded: () => void }) {
  const [state, setState] = useState<{ ids: string[]; geo: GeoIndex } | null>(null);
  useEffect(() => {
    let alive = true;
    void Promise.all([getProfile(), getPreferences(), loadGeo()]).then(([profile, prefs, geo]) => {
      if (alive) setState({ ids: suggestedLocations(profile.location, prefs.locations, geo), geo });
    });
    return () => {
      alive = false;
    };
  }, []);
  if (!state || state.ids.length === 0) return null;
  const add = async (id: string) => {
    const prefs = await getPreferences();
    if (!prefs.locations.includes(id)) await savePreferences({ ...prefs, locations: [...prefs.locations, id] });
    setState({ ...state, ids: state.ids.filter((x) => x !== id) });
    onAdded();
  };
  return (
    <div className="mb-5 rounded-2xl bg-accent-soft px-5 py-4 text-sm">
      <p className="font-medium text-ink">From your Profile. Add as a location?</p>
      <div className="mt-2.5 flex flex-wrap gap-2">
        {state.ids.map((id) => (
          <button
            key={id}
            type="button"
            onClick={() => void add(id)}
            className="rounded-full border border-accent bg-white px-3.5 py-1.5 text-[13px] font-medium text-accent-deep transition hover:bg-accent-soft focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-accent/25"
          >
            Add {choiceLabel(id, state.geo)}
          </button>
        ))}
      </div>
    </div>
  );
}

export default function OnboardingWizard() {
  const [step, setStepState] = useState(0);
  // Remounts PreferencesCard after a suggested location is saved, so its draft picks it up.
  const [prefsVersion, setPrefsVersion] = useState(0);
  useEffect(() => setStepState(loadStep()), []);
  const setStep = (n: number) => {
    const next = Math.max(0, Math.min(STEPS.length - 1, n));
    setStepState(next);
    saveStep(next);
    window.scrollTo({ top: 0 });
  };

  const setup = useLiveQuery(async () => {
    const [settings, profile, preferences, masterProfile] = await Promise.all([getSettings(), getProfile(), getPreferences(), getMasterProfile()]);
    return readiness({ settings, profile, preferences, masterProfile });
  }, []);
  const keySaved = !!setup?.items.find((i) => i.key === "key")?.done;

  const current = STEPS[step];
  const isFirst = step === 0;
  const isLast = step === STEPS.length - 1;
  const nextLabel = step === 0 ? "Get started" : current.key === "key" && !keySaved ? "Skip for now" : "Next";

  return (
    <div className="mx-auto max-w-2xl">
      <ol className="mb-8 flex items-center gap-1.5" aria-label="Setup steps">
        {STEPS.map((s, i) => (
          <li key={s.key} className="flex-1">
            <button
              type="button"
              onClick={() => setStep(i)}
              aria-label={`Step ${i + 1}: ${s.title}`}
              aria-current={i === step ? "step" : undefined}
              className={`block h-1.5 w-full rounded-full transition-colors focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-accent/25 ${
                i <= step ? "bg-accent" : "bg-black/[0.08] hover:bg-black/[0.15]"
              }`}
            />
          </li>
        ))}
      </ol>
      <p className="mb-2 text-[13px] font-medium text-muted">
        Step {step + 1} of {STEPS.length}
      </p>
      <h1 className="text-[34px] font-semibold leading-tight tracking-display sm:text-[40px]">{current.title}</h1>
      {current.lead ? <p className="mb-8 mt-3 text-[17px] leading-relaxed text-muted">{current.lead}</p> : <div className="mb-8" />}

      {current.key === "welcome" && (
        <div className="mb-6 rounded-[22px] bg-white p-6 shadow-soft">
          <p className="text-[15px] leading-relaxed">
            Paste a job link to see if it fits you, get a tailored resume, and track every application. Setup takes about five minutes.
          </p>
          <ul className="mt-4 grid gap-3 text-sm leading-relaxed">
            <li>
              <strong>Your data stays in this browser.</strong> There is no server.
            </li>
            <li>
              <strong>You pay Anthropic directly</strong>, with your own key. Job text and your experience are sent to Anthropic.
            </li>
            <li>
              <strong>Nothing is ever submitted for you.</strong> You always take the final step.
            </li>
          </ul>
          <p className="mt-4 text-[13px]">
            <Link href="/privacy" className="text-accent hover:underline">
              Privacy details
            </Link>
          </p>
        </div>
      )}

      {current.key === "key" && (
        <>
          <ol className="mb-6 grid gap-3 rounded-[22px] bg-white p-6 text-[15px] leading-relaxed shadow-soft">
            <li className="flex gap-3">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent-soft text-xs font-semibold text-accent-deep">1</span>
              <span>
                Sign in at{" "}
                <a
                  href="https://console.anthropic.com/settings/keys"
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-0.5 font-medium text-accent hover:underline"
                >
                  console.anthropic.com
                  <ExternalLinkIcon />
                </a>{" "}
                and create an API key.
              </span>
            </li>
            <li className="flex gap-3">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent-soft text-xs font-semibold text-accent-deep">2</span>
              <span>Add at least $5 of credit under Billing.</span>
            </li>
            <li className="flex gap-3">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent-soft text-xs font-semibold text-accent-deep">3</span>
              <span>Set a monthly spend limit under Limits.</span>
            </li>
            <li className="flex gap-3">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent-soft text-xs font-semibold text-accent-deep">4</span>
              <span>Paste the key below and test it.</span>
            </li>
          </ol>
          <ApiKeyCard compact />
          {!keySaved && <p className="-mt-2 mb-6 text-[13px] text-muted">You can skip this and add it later.</p>}
        </>
      )}

      {current.key === "master" && <MasterProfileCard />}

      {current.key === "profile" && <ProfileCard />}

      {current.key === "preferences" && (
        <>
          <LocationSuggestion onAdded={() => setPrefsVersion((v) => v + 1)} />
          <PreferencesCard key={prefsVersion} />
        </>
      )}

      {current.key === "done" && (
        <>
          <div className="mb-6 rounded-[22px] bg-white p-6 text-center shadow-soft">
            <p className="text-[21px] font-semibold tracking-display">Try it on a real job.</p>
            <p className="mt-2 text-[15px] text-muted">Paste a job link, or import your old tracker as a CSV.</p>
            <div className="mt-6 flex flex-wrap justify-center gap-2">
              <Link href="/?add=1" className={primaryLinkClass}>
                Paste a job link
              </Link>
              <Link href="/?import=1" className={secondaryLinkClass}>
                Import a CSV
              </Link>
            </div>
          </div>
          {setup && <ReadinessStrip readiness={setup} />}
        </>
      )}

      <div className="flex justify-between gap-3">
        <Button variant="secondary" onClick={() => setStep(step - 1)} disabled={isFirst}>
          Back
        </Button>
        {!isLast && <Button onClick={() => setStep(step + 1)}>{nextLabel}</Button>}
      </div>
    </div>
  );
}
