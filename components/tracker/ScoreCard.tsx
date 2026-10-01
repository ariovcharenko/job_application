import type { StoredBreakdown } from "@/lib/intake/analyze";
import type { Criterion, CriterionStatus } from "@/lib/scoring/criteria";
import type { Verdict } from "@/lib/scoring/score";
import ApplyVerdict from "./ApplyVerdict";

const VERDICT_STYLE: Record<Verdict, string> = {
  Apply: "bg-accent-soft text-accent-deep ring-transparent",
  Maybe: "bg-black/[0.05] text-ink ring-transparent",
  Skip: "bg-black/[0.04] text-muted ring-transparent",
};

export function VerdictBadge({ verdict }: { verdict: Verdict }) {
  return <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ring-inset ${VERDICT_STYLE[verdict]}`}>{verdict}</span>;
}

const STATUS_STYLE: Record<CriterionStatus, { tone: string; label: string }> = {
  pass: { tone: "bg-good-soft text-good", label: "Yes" },
  fail: { tone: "bg-bad-soft text-bad", label: "No" },
  unknown: { tone: "bg-black/[0.05] text-muted", label: "Unclear" },
};

function CriterionIcon({ status }: { status: CriterionStatus }) {
  if (status === "pass") {
    return (
      <svg viewBox="0 0 16 16" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="m3.5 8.5 3 3 6-7" />
      </svg>
    );
  }
  if (status === "fail") {
    return (
      <svg viewBox="0 0 16 16" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
        <path d="M4.5 4.5l7 7M11.5 4.5l-7 7" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 16 16" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M6 6.2a2 2 0 1 1 2.6 1.9c-.4.2-.6.5-.6.9v.6" />
      <path d="M8 11.8h.01" />
    </svg>
  );
}

export function CriteriaList({ criteria }: { criteria: Criterion[] }) {
  return (
    <ul className="grid gap-2">
      {criteria.map((c) => {
        const st = STATUS_STYLE[c.status];
        return (
          <li key={c.key} className="flex items-start gap-3 text-sm">
            <span role="img" aria-label={st.label} className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${st.tone}`}>
              <CriterionIcon status={c.status} />
            </span>
            <span>
              <span className="font-medium">{c.label}</span>
              <span className="block text-xs leading-relaxed text-muted">{c.detail}</span>
            </span>
          </li>
        );
      })}
    </ul>
  );
}

export default function ScoreCard({ result }: { result: StoredBreakdown }) {
  // Jobs analyzed since the must-have filters exist show only the verdict: one number, one answer.
  // The older weighted score is still stored (the hidden Feed sorts by it) but no longer shown,
  // since two different numbers for the same job was confusing.
  if (result.decision) {
    const role = result.criteria?.find((c) => c.key === "role" && c.status !== "pass");
    return <ApplyVerdict decision={result.decision} skills={result.skills} note={role?.detail} />;
  }
  return (
    <div className="rounded-2xl bg-paper p-4">
      <ScoreDetails result={result} />
    </div>
  );
}

function ScoreDetails({ result }: { result: StoredBreakdown }) {
  return (
    <>
      <div className="flex items-center gap-3">
        <span className="text-3xl font-semibold tabular-nums tracking-tight">{result.score}</span>
        <VerdictBadge verdict={result.verdict} />
        {result.score !== result.rawScore && (
          <span className="text-xs text-muted">(would be {result.rawScore} without the cap below)</span>
        )}
      </div>

      {result.cappedBy.length > 0 && (
        <div className="mt-3 rounded-xl bg-bad-soft px-3 py-2 text-sm text-bad">
          <p className="font-medium">Score capped:</p>
          <ul className="list-disc pl-5">
            {result.cappedBy.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        </div>
      )}

      {result.criteria && result.criteria.length > 0 && (
        <div className="mt-4 rounded-lg border border-black/[0.06] bg-white p-3">
          <p className="mb-2.5 text-[13px] font-medium text-ink">Can you apply?</p>
          <CriteriaList criteria={result.criteria} />
        </div>
      )}

      <div className="mt-4 grid gap-3">
        {result.factors.map((f) => (
          <div key={f.key}>
            <div className="flex justify-between text-sm">
              <span className="font-medium">{f.label}</span>
              <span className="tabular-nums text-muted">
                {f.points}/{f.max}
              </span>
            </div>
            <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-black/[0.07]">
              <div
                className="h-1.5 rounded-full bg-accent transition-all"
                style={{ width: `${f.max ? (f.points / f.max) * 100 : 0}%` }}
              />
            </div>
            <p className="mt-1 text-xs text-muted">{f.note}</p>
          </div>
        ))}
      </div>
    </>
  );
}
