"use client";

import Link from "next/link";
import { describeAIError } from "@/lib/ai/errors";

/**
 * An AI call's error with the one link that fixes it (add credit, check the key, add the key in
 * Settings...). Pass the caught error as is; see lib/ai/errors.ts for the mapping.
 */
export default function AIErrorNotice({ error }: { error: unknown }) {
  const { message, fix } = describeAIError(error);
  return (
    <div role="alert" className="mt-3 rounded-2xl bg-bad-soft px-4 py-3 text-sm leading-relaxed text-bad">
      <p>{message}</p>
      {fix &&
        (fix.external ? (
          <a href={fix.href} target="_blank" rel="noreferrer" className="mt-1 inline-flex items-center gap-1 font-medium underline underline-offset-2">
            {fix.label}
            <svg viewBox="0 0 16 16" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M6 3h7v7M13 3 5 11" />
            </svg>
            <span className="sr-only">(opens in a new tab)</span>
          </a>
        ) : (
          <Link href={fix.href} className="mt-1 inline-block font-medium underline underline-offset-2">
            {fix.label}
          </Link>
        ))}
    </div>
  );
}
