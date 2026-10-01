import { MUST_HAVE_FILTERS, verdictFor, VERDICT_TEXT, type ApplyDecision, type FilterResult, type SkillsMatch, type Verdict } from "@/lib/intake/decision";

// The answer to "should I apply?", kept deliberately quiet: one number, one verdict, then the
// must-haves as small pills and the skills behind the number. Color is only used to carry meaning
// (the icon inside a pill), never as a background wash.

const VERDICT_DOT: Record<Verdict, string> = {
  apply: "bg-accent",
  "low-match": "bg-warn",
  "dont-apply": "bg-bad",
};

const shortLabel = (f: FilterResult) => f.short ?? MUST_HAVE_FILTERS.find((m) => m.key === f.key)?.short ?? f.label;

function StatusIcon({ status }: { status: FilterResult["status"] }) {
  if (status === "pass") {
    return (
      <svg viewBox="0 0 16 16" className="h-3.5 w-3.5 text-good" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-label="Met">
        <path d="m3.5 8.5 3 3 6-7" />
      </svg>
    );
  }
  if (status === "fail") {
    return (
      <svg viewBox="0 0 16 16" className="h-3.5 w-3.5 text-bad" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-label="Not met">
        <path d="M4.5 4.5l7 7M11.5 4.5l-7 7" />
      </svg>
    );
  }
  return (
    <span aria-label="Not stated" className="flex h-3.5 w-3.5 items-center justify-center text-[11px] font-semibold text-muted">
      ?
    </span>
  );
}

function Pill({ f }: { f: FilterResult }) {
  return (
    <li
      title={`${f.label}: ${f.details.join(" ")}`}
      className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[13px] ${
        f.status === "unknown" ? "border-dashed border-black/20 text-muted" : "border-black/[0.1] text-ink"
      } ${f.status === "fail" ? "border-bad/30" : ""}`}
    >
      <StatusIcon status={f.status} />
      {shortLabel(f)}
    </li>
  );
}

/** The reason behind each failed or unclear must-have, on screen rather than only in a tooltip. */
function FilterReasons({ filters }: { filters: FilterResult[] }) {
  const shown = filters.filter((f) => f.status !== "pass" && f.details.length > 0);
  if (shown.length === 0) return null;
  return (
    <ul className="mt-3 grid gap-1">
      {shown.map((f) => (
        <li key={f.key} className="flex items-start gap-1.5 text-xs leading-relaxed text-muted">
          <span className="mt-[1px] shrink-0">
            <StatusIcon status={f.status} />
          </span>
          <span>
            <span className="font-medium text-ink">{shortLabel(f)}:</span> {f.details.join(" ")}
          </span>
        </li>
      ))}
    </ul>
  );
}

function SkillRow({ label, have, gap }: { label: string; have: string[]; gap: string[] }) {
  const total = have.length + gap.length;
  if (total === 0) return null;
  return (
    <div className="grid gap-2 sm:grid-cols-[120px_1fr] sm:gap-4">
      <p className="text-[13px] text-muted">
        {label} <span className="tabular-nums">{have.length}/{total}</span>
      </p>
      <p className="text-[13px] leading-relaxed">
        {have.map((s, i) => (
          <span key={`h-${s}`}>
            <span className="text-ink">{s}</span>
            {i < have.length - 1 || gap.length ? <span className="text-black/25"> · </span> : null}
          </span>
        ))}
        {gap.map((s, i) => (
          <span key={`g-${s}`}>
            <span className="text-muted line-through decoration-black/30">
              {s}
              <span className="sr-only"> (missing)</span>
            </span>
            {i < gap.length - 1 ? <span className="text-black/25"> · </span> : null}
          </span>
        ))}
      </p>
    </div>
  );
}

const MissingCaption = () => <p className="text-xs text-muted">Struck through: not in your experience yet.</p>;

/** The headline for a job: a match percentage, a verdict, and the must-haves behind it. */
export default function ApplyVerdict({
  decision,
  skills,
  note,
}: {
  decision: ApplyDecision;
  skills: SkillsMatch | null | undefined;
  /** A soft, informational note (e.g. "Outside the roles you picked"). Never changes the verdict. */
  note?: string;
}) {
  const pct = skills?.percent ?? null;
  const verdict = verdictFor(decision, pct);
  const unclear = decision.filters.filter((f) => f.status === "unknown").length;
  const basisLabel = skills?.basis === "keywords" ? "Keyword match" : "Skills match";
  const mentioned = skills?.basis === "mentioned";
  const reason =
    verdict === "dont-apply"
      ? decision.failed.map((f) => f.details.join(" ")).join(" ")
      : pct === null
        ? skills
          ? "The posting is too short to compare with your profile."
          : "Add your experience on the Resumes page to see how you match."
        : unclear > 0
          ? `Nothing rules you out, but ${unclear} of your must-haves ${unclear === 1 ? "is" : "are"} unclear.`
          : VERDICT_TEXT[verdict].detail;

  return (
    <section className="rounded-2xl border border-black/[0.08] bg-white">
      <div className="flex items-start justify-between gap-6 p-6">
        <div>
          <p className="text-[13px] font-medium text-muted">{basisLabel}</p>
          <p className={`mt-1 text-[56px] font-semibold leading-none tracking-display tabular-nums ${pct === null ? "text-black/20" : "text-accent"}`}>
            {pct === null ? "–" : `${pct}%`}
          </p>
        </div>
        <div className="max-w-[60%] text-right">
          <p className="inline-flex items-center gap-2 text-[17px] font-semibold tracking-display">
            <span className={`h-2 w-2 rounded-full ${VERDICT_DOT[verdict]}`} aria-hidden="true" />
            {VERDICT_TEXT[verdict].label}
          </p>
          <p className="mt-1 text-[13px] leading-relaxed text-muted">{reason}</p>
          {note && <p className="mt-1 text-xs leading-relaxed text-muted">{note}</p>}
        </div>
      </div>

      {decision.filters.length > 0 && (
        <div className="border-t border-black/[0.06] px-6 py-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className="text-[13px] font-medium text-ink">Your must-haves</p>
            {unclear > 0 && (
              <p className="text-xs text-muted">
                ? = unclear: not stated in the posting, or not set in your Profile or Preferences. Check {unclear === 1 ? "it" : "these"} before applying.
              </p>
            )}
          </div>
          <ul className="mt-3 flex flex-wrap gap-2">
            {decision.filters.map((f) => (
              <Pill key={f.key} f={f} />
            ))}
          </ul>
          <FilterReasons filters={decision.filters} />
        </div>
      )}

      {skills && !mentioned && skills.basis !== "keywords" && skills.required.have.length + skills.required.gap.length + skills.preferred.have.length + skills.preferred.gap.length > 0 && (
        <div className="grid gap-2.5 border-t border-black/[0.06] px-6 py-4">
          <SkillRow label="Required" have={skills.required.have} gap={skills.required.gap} />
          <SkillRow label="Nice to have" have={skills.preferred.have} gap={skills.preferred.gap} />
          {skills.required.gap.length + skills.preferred.gap.length > 0 && <MissingCaption />}
        </div>
      )}
      {mentioned && skills && (
        <div className="grid gap-2.5 border-t border-black/[0.06] px-6 py-4">
          <SkillRow label="Mentioned" have={skills.required.have} gap={skills.required.gap} />
          {skills.required.gap.length > 0 && <MissingCaption />}
          <p className="text-xs text-muted">The posting doesn&apos;t list required skills separately, so this counts every technology it mentions.</p>
        </div>
      )}
      {skills?.basis === "keywords" && (
        <p className="border-t border-black/[0.06] px-6 py-4 text-xs leading-relaxed text-muted">
          The posting doesn&apos;t list specific skills, so this compares its wording with your experience. Treat it as a rough guide.
        </p>
      )}
    </section>
  );
}
