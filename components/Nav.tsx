"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { FEATURES } from "@/lib/features";

const ICON = {
  tracker: "M4 5h16M4 12h16M4 19h10",
  feed: "M4 11a9 9 0 0 1 9 9M4 4a16 16 0 0 1 16 16M5 19h.01",
  settings:
    "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z",
  privacy: "M12 3 5 6v5c0 4.5 3 8.3 7 10 4-1.7 7-5.5 7-10V6l-7-3Z",
  resumes: "M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5ZM14 3v5h5M9 13h6M9 17h6",
};

/** Fired by the nav's "Add job" button when the tracker is already open. */
export const OPEN_ADD_JOB_EVENT = "job-copilot:add-job";

const LINKS = [
  { href: "/", label: "Tracker", icon: ICON.tracker },
  { href: "/resumes", label: "Resumes", icon: ICON.resumes },
  ...(FEATURES.jobFeed ? [{ href: "/feed", label: "Feed", icon: ICON.feed }] : []),
  { href: "/settings", label: "Settings", icon: ICON.settings },
  { href: "/privacy", label: "Privacy", icon: ICON.privacy },
];

export default function Nav() {
  const pathname = usePathname();
  return (
    <header className="sticky top-0 z-40 border-b border-black/[0.06] bg-[rgba(251,251,253,0.8)] backdrop-blur-xl backdrop-saturate-[1.8]">
      <nav className="mx-auto flex h-12 max-w-[1080px] items-center gap-3 px-4 sm:gap-6 sm:px-6">
        <Link href="/" className="flex items-center gap-2 text-[15px] font-semibold tracking-display">
          <span className="flex h-6 w-6 items-center justify-center rounded-[7px] bg-gradient-to-br from-[#2997FF] via-[#7B61FF] to-[#C850C0] text-white">
            <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="m5 12.5 4.5 4.5L19 7.5" />
            </svg>
          </span>
          <span className="sr-only sm:not-sr-only">Job Copilot</span>
        </Link>
        <div className="flex min-w-0 items-center gap-0.5 sm:gap-5">
          {LINKS.map((l) => {
            const active = l.href === "/" ? pathname === "/" : pathname.startsWith(l.href);
            return (
              <Link
                key={l.href}
                href={l.href}
                aria-current={active ? "page" : undefined}
                className={`flex min-h-[32px] min-w-[32px] items-center justify-center gap-1.5 rounded-full px-2 py-1 text-[13px] transition-colors focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-accent/25 ${
                  active ? "font-medium text-ink" : "text-black/60 hover:text-ink"
                }`}
              >
                <svg viewBox="0 0 24 24" className="h-4 w-4 sm:hidden" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d={l.icon} />
                </svg>
                <span className="sr-only sm:not-sr-only">{l.label}</span>
              </Link>
            );
          })}
        </div>
        <Link
          href="/?add=1"
          onClick={(e) => {
            // Already on the tracker: the page doesn't remount on a same-route link, so ask it directly.
            if (pathname === "/") {
              e.preventDefault();
              window.dispatchEvent(new Event(OPEN_ADD_JOB_EVENT));
            }
          }}
          className="ml-auto inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full bg-accent px-3.5 py-1 text-[13px] font-medium text-white transition hover:bg-accent-deep focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-accent/25"
        >
          <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
            <path d="M12 5v14M5 12h14" />
          </svg>
          Add job
        </Link>
      </nav>
    </header>
  );
}
