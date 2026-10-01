import Link from "next/link";

export const metadata = { title: "Page not found" };

export default function NotFound() {
  return (
    <div className="animate-rise mx-auto max-w-xl rounded-[22px] bg-white px-6 py-14 text-center shadow-soft sm:px-10">
      <p className="text-[15px] font-semibold tabular-nums text-accent">404</p>
      <h1 className="mt-2 text-[28px] font-semibold leading-tight tracking-display">Page not found</h1>
      <p className="mt-3 text-[15px] leading-relaxed text-muted">That page doesn&apos;t exist. Your jobs and settings are on the tracker.</p>
      <Link
        href="/"
        className="mt-7 inline-flex items-center justify-center rounded-full bg-accent px-[18px] py-2 text-[14px] font-medium text-white transition hover:bg-accent-deep focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-accent/25"
      >
        Back to the tracker
      </Link>
    </div>
  );
}
