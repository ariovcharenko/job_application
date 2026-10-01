import Link from "next/link";

// First run on "/": no API key and nothing tracked yet. Shown under the hero in place of the
// stats and table, so a stranger sees what the app does, what it costs and where data goes
// before being asked for anything.

const JOBS: { title: string; body: string; icon: React.ReactNode }[] = [
  {
    title: "Check if a job is worth it",
    body: "Paste a link. See if it meets your must-haves and how many of its skills you have.",
    icon: <path d="m5 12.5 4.5 4.5L19 7.5" />,
  },
  {
    title: "Tailor your resume",
    body: "A one-page resume for that job, written only from your real experience.",
    icon: <path d="M7 3h7l5 5v13H7zM14 3v5h5M10 13h6M10 17h6" />,
  },
  {
    title: "Track every application",
    body: "Stages, follow-ups and notes in one place. Import your old tracker as a CSV.",
    icon: <path d="M4 5h16M4 12h16M4 19h10" />,
  },
];

export const primaryLinkClass =
  "inline-flex items-center justify-center rounded-full bg-accent px-5 py-2.5 text-[15px] font-medium text-white transition hover:bg-accent-deep focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-accent/25";
export const secondaryLinkClass =
  "inline-flex items-center justify-center rounded-full bg-black/[0.05] px-5 py-2.5 text-[15px] font-medium text-ink transition hover:bg-black/[0.08] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-accent/25";

export default function SetupCard({ onImportCsv }: { onImportCsv?: () => void }) {
  return (
    <section aria-labelledby="setup-title" className="animate-rise rounded-[22px] bg-white p-6 shadow-soft sm:p-8">
      <h2 id="setup-title" className="text-[28px] font-semibold leading-tight tracking-display">
        Get set up (about 5 minutes)
      </h2>
      <p className="mt-2 max-w-2xl text-[15px] leading-relaxed text-muted">Add your Claude API key, your experience and what you&apos;re looking for.</p>

      <ul className="mt-6 grid gap-4 md:grid-cols-3">
        {JOBS.map((j) => (
          <li key={j.title} className="rounded-2xl bg-paper p-5">
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-accent-soft text-accent">
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                {j.icon}
              </svg>
            </div>
            <p className="mt-3 font-semibold tracking-display">{j.title}</p>
            <p className="mt-1 text-sm leading-relaxed text-muted">{j.body}</p>
          </li>
        ))}
      </ul>

      <dl className="mt-6 grid gap-3 text-sm sm:grid-cols-2">
        <div>
          <dt className="font-semibold">What it costs</dt>
          <dd className="mt-0.5 text-muted">
            The app is free. Anthropic charges your key about 1 to 2¢ per job check and 5¢ per resume.
          </dd>
        </div>
        <div>
          <dt className="font-semibold">Where your data goes</dt>
          <dd className="mt-0.5 text-muted">
            It stays in this browser. Job text and your experience go only to Anthropic.{" "}
            <Link href="/privacy" className="text-accent hover:underline">
              Privacy
            </Link>
          </dd>
        </div>
      </dl>

      <div className="mt-7 flex flex-wrap gap-3">
        <Link href="/onboarding" className={primaryLinkClass}>
          Start setup
        </Link>
        <Link href="/example" className={secondaryLinkClass}>
          See an example first
        </Link>
        {onImportCsv && (
          <button type="button" onClick={onImportCsv} className={secondaryLinkClass}>
            Import a CSV
          </button>
        )}
      </div>
      <p className="mt-4 text-[13px] text-muted">
        Moving from another browser? Restore your backup in{" "}
        <Link href="/settings#backup-and-restore" className="text-accent hover:underline">
          Settings
        </Link>
        .
      </p>
    </section>
  );
}
