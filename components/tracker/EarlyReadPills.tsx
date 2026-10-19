import { earlyPills } from "@/lib/intake/earlyRead";
import type { EarlyRead } from "@/lib/intake/earlyRead";
import type { CandidateFacts } from "@/lib/eligibility/candidate";
import type { ExperienceLevel, MustHaves } from "@/lib/types";

/**
 * The instant "Early read" from Jev, shown on the must-haves while Claude's check runs. Muted and
 * dashed on purpose: it is a hint, not a result, and it disappears when the real check arrives.
 */
export default function EarlyReadPills({ read, mustHaves, candidate, experienceLevel }: { read: EarlyRead; mustHaves: MustHaves; candidate?: CandidateFacts; experienceLevel?: ExperienceLevel }) {
  const pills = earlyPills(read, mustHaves, candidate, { experienceLevel });
  if (!pills.length) return null;
  return (
    <div className="mt-4" role="status" aria-label="Early read">
      <p className="mb-2 text-[13px] font-medium text-muted">Early read, until the full check finishes</p>
      <ul className="flex flex-wrap gap-2">
        {pills.map((p) => (
          <li
            key={p.label}
            className={`rounded-full border border-dashed px-3 py-1 text-[13px] ${p.tone === "flag" ? "border-black/30 bg-paper font-medium text-ink" : "border-black/20 text-muted"}`}
          >
            {p.label}
          </li>
        ))}
      </ul>
    </div>
  );
}
