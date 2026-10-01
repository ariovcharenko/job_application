import { parseMasterExperiences } from "./resume/master/experiences";
import { parseSkillInventory } from "./resume/master/skills";
import type { AppSettings, Preferences, Profile } from "./types";

// "Is this browser set up enough to check jobs well?" Six checks, derived from what's already
// stored (nothing new is saved). Each one links to the Settings / Resumes card that fixes it; the
// anchors are slugify(Card title) (components/ui.tsx), so they must follow the card titles.

export type ReadinessKey = "key" | "contact" | "experience" | "sponsorship" | "level" | "locations";

export interface ReadinessItem {
  key: ReadinessKey;
  label: string;
  done: boolean;
  /** Where it's fixed. */
  href: string;
  /** Short action for the link ("Add your key"). */
  action: string;
}

export interface Readiness {
  items: ReadinessItem[];
  done: number;
  total: number;
  complete: boolean;
  /** The first item still to do, in the order above, or null. */
  next: ReadinessItem | null;
}

export const READINESS_LINKS = {
  key: "/settings#anthropic-api-key",
  profile: "/settings#profile",
  experience: "/resumes#your-experience",
  preferences: "/settings#job-preferences",
} as const;

export interface ReadinessInput {
  settings: Pick<AppSettings, "anthropicKey">;
  profile: Pick<Profile, "fullName" | "email" | "requiresSponsorship">;
  masterProfile: string;
  preferences: Pick<Preferences, "experienceLevel" | "locations">;
}

const filled = (s: string | undefined) => (s ?? "").trim() !== "";

export function readiness({ settings, profile, masterProfile, preferences }: ReadinessInput): Readiness {
  const hasRole = parseMasterExperiences(masterProfile).length > 0;
  const hasSkill = parseSkillInventory(masterProfile).length > 0;
  const items: ReadinessItem[] = [
    {
      key: "key",
      label: "Connect your Anthropic API key",
      done: filled(settings.anthropicKey),
      href: READINESS_LINKS.key,
      action: "Add your key",
    },
    {
      key: "contact",
      label: "Add your name and email",
      done: filled(profile.fullName) && filled(profile.email),
      href: READINESS_LINKS.profile,
      action: "Open Profile",
    },
    {
      key: "experience",
      label: "Add your experience: at least one role and a skills list",
      done: hasRole && hasSkill,
      href: READINESS_LINKS.experience,
      action: "Add experience",
    },
    {
      key: "sponsorship",
      label: "Answer whether you'll need visa sponsorship",
      done: profile.requiresSponsorship === "yes" || profile.requiresSponsorship === "no",
      href: READINESS_LINKS.profile,
      action: "Answer it",
    },
    {
      key: "level",
      label: "Choose your experience level",
      done: filled(preferences.experienceLevel),
      href: READINESS_LINKS.preferences,
      action: "Choose level",
    },
    {
      key: "locations",
      label: "Pick at least one location",
      done: (preferences.locations ?? []).length > 0,
      href: READINESS_LINKS.preferences,
      action: "Pick locations",
    },
  ];
  const done = items.filter((i) => i.done).length;
  return { items, done, total: items.length, complete: done === items.length, next: items.find((i) => !i.done) ?? null };
}
