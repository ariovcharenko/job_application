import type { QuickResult as Quick } from "@/lib/intake/quick";

/**
 * The provisional result shown while Claude's full check runs. Muted on purpose (dashed gray, no
 * purple): purple means "confirmed good", and this is an estimate. It is replaced by the normal
 * verdict when the check finishes, and the final result simply wins if it differs.
 */
export default function QuickResult({ result }: { result: Quick | null }) {
  if (!result) return null;
  const fit = result.kind === "not-a-fit";
  return (
    <div className="mt-4 rounded-2xl border border-dashed border-black/20 bg-paper p-5" role="status" aria-label="Quick estimate">
      <p className="text-[13px] font-medium text-muted">Quick estimate</p>
      {fit ? (
        <>
          <p className="mt-1 text-xl font-semibold tracking-display text-ink">Not a fit (early read)</p>
          <p className="mt-1 text-sm text-muted">{result.reason}</p>
          {result.percent !== null && <p className="mt-1 text-[13px] text-muted">Skills overlap {result.percent}%. Doesn&apos;t count while a must-have fails.</p>}
        </>
      ) : (
        <>
          <p className="mt-1 text-xl font-semibold tracking-display text-ink">
            {result.percent}% <span className="text-base font-medium text-muted">skills overlap</span>
          </p>
          <p className="mt-1 text-sm text-muted">{result.reason}</p>
          {result.headline.summary && <p className="mt-1 text-[13px] text-muted">{result.headline.summary}</p>}
        </>
      )}
      <div className="mt-3 flex items-center gap-2 text-[13px] text-muted">
        <span className="relative h-1 w-16 overflow-hidden rounded-full bg-black/10" aria-hidden="true">
          <span className="absolute inset-y-0 w-1/3 animate-pulse rounded-full bg-black/30" />
        </span>
        Full check running...
      </div>
    </div>
  );
}
