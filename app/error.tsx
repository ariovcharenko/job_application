"use client";

import Link from "next/link";
import { useEffect } from "react";
import { Button } from "@/components/ui";

/** Any page that crashes while rendering lands here instead of a blank screen. */
export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <div className="animate-rise mx-auto max-w-xl rounded-[22px] bg-white px-6 py-14 text-center shadow-soft sm:px-10">
      <div className="mx-auto mb-5 flex h-12 w-12 items-center justify-center rounded-full bg-bad-soft text-bad">
        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M12 8v5M12 16.5h.01M10.3 3.9 2.4 17.6A2 2 0 0 0 4.1 20.6h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
        </svg>
      </div>
      <h1 className="text-[28px] font-semibold leading-tight tracking-display">Something went wrong</h1>
      <p className="mt-3 text-[15px] leading-relaxed text-muted">
        This page hit an error. Your saved jobs and settings are still in this browser. Try again, or go back to your tracker.
      </p>
      {error.message && (
        <p className="mx-auto mt-4 max-w-md break-words rounded-2xl bg-paper px-4 py-3 text-left font-mono text-xs leading-relaxed text-muted">
          {error.message}
        </p>
      )}
      <div className="mt-7 flex flex-wrap justify-center gap-2">
        <Button onClick={reset}>Try again</Button>
        <Link
          href="/"
          className="inline-flex items-center justify-center rounded-full bg-black/[0.05] px-[18px] py-2 text-[14px] font-medium text-ink transition hover:bg-black/[0.08] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-accent/25"
        >
          Back to the tracker
        </Link>
      </div>
    </div>
  );
}
