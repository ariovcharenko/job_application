import Link from "next/link";
import type { Readiness } from "@/lib/readiness";

/** "3 of 6 done": a compact setup checklist on "/" until every item is done. */
export default function ReadinessStrip({ readiness }: { readiness: Readiness }) {
  if (readiness.complete) return null;
  const todo = readiness.items.filter((i) => !i.done);
  const pct = Math.round((readiness.done / readiness.total) * 100);
  return (
    <section aria-label="Setup progress" className="mb-10 rounded-[22px] bg-white p-5 shadow-soft">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-[15px] font-semibold tracking-display">
          Setup: {readiness.done} of {readiness.total} done
        </p>
        <Link href="/onboarding" className="text-sm font-medium text-accent hover:underline">
          Finish setup
        </Link>
      </div>
      <div
        className="mt-3 h-1.5 overflow-hidden rounded-full bg-black/[0.06]"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={readiness.total}
        aria-valuenow={readiness.done}
        aria-label={`${readiness.done} of ${readiness.total} setup steps done`}
      >
        <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${pct}%` }} />
      </div>
      <ul className="mt-4 grid gap-2 text-sm sm:grid-cols-2">
        {todo.map((i) => (
          <li key={i.key} className="flex items-start gap-2">
            <span className="mt-1 h-3 w-3 shrink-0 rounded-full border-2 border-black/25" aria-hidden="true" />
            <span className="min-w-0">
              {i.label}.{" "}
              <Link href={i.href} className="whitespace-nowrap font-medium text-accent hover:underline">
                {i.action}
              </Link>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
