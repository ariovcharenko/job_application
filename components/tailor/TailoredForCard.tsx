"use client";

/**
 * What was done differently for this job, in plain words (lib/resume/engine/tailored.ts): how the
 * job reads, which role got the most room, what the skills lines lead with and what was left off.
 */
export default function TailoredForCard({ lines }: { lines: string[] }) {
  if (lines.length === 0) return null;
  return (
    <section className="rounded-2xl bg-accent-soft/40 p-5" aria-labelledby="tailored-for-heading">
      <h3 id="tailored-for-heading" className="mb-2 text-[15px] font-semibold tracking-display">
        Tailored for this job
      </h3>
      <ul className="grid gap-1.5 text-sm">
        {lines.map((l) => (
          <li key={l} className="flex gap-2">
            <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-accent" aria-hidden="true" />
            <span>{l}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
