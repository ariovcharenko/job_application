"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import ApplyVerdict from "@/components/tracker/ApplyVerdict";
import { primaryLinkClass, secondaryLinkClass } from "@/components/SetupCard";
import { Spinner } from "@/components/ui";
import { EXAMPLE_HEADER, EXAMPLE_POSTING, EXAMPLE_RESUME } from "@/lib/example/fixture";
import { runExample } from "@/lib/example/run";
import type { JobAssessment } from "@/lib/intake/analyze";
import { PAGE_CSS, renderResumeHtml } from "@/lib/resume/engine/html";

// Rendered once at module load: fixed sample data, escaped by renderResumeHtml.
const RESUME_HTML = renderResumeHtml(EXAMPLE_HEADER, EXAMPLE_RESUME);

/** A scaled picture of the sample resume page that fits the column (and a 375px phone). */
function SampleResume() {
  const [width, setWidth] = useState(340);
  const [box, setBox] = useState<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!box) return;
    const measure = () => setWidth(Math.min(box.clientWidth, 520));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(box);
    return () => ro.disconnect();
  }, [box]);
  const scale = width / (8.5 * 96);
  return (
    <div ref={setBox} className="w-full">
      <div
        className="mx-auto overflow-hidden rounded-lg bg-white shadow-lift ring-1 ring-black/[0.06]"
        style={{ width, height: 11 * 96 * scale }}
        role="img"
        aria-label="Sample tailored resume for Jordan Lee"
      >
        <div style={{ transform: `scale(${scale})`, transformOrigin: "top left", width: "8.5in" }} aria-hidden="true">
          <style>{PAGE_CSS}</style>
          <div dangerouslySetInnerHTML={{ __html: RESUME_HTML }} />
        </div>
      </div>
    </div>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-[22px] bg-white p-6 shadow-soft sm:p-8">
      <p className="text-[13px] font-medium text-muted">Step {n}</p>
      <h2 className="mt-1 text-[22px] font-semibold tracking-display">{title}</h2>
      <div className="mt-4">{children}</div>
    </section>
  );
}

export default function ExampleView() {
  const [a, setA] = useState<JobAssessment | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    runExample()
      .then(setA)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  return (
    <div className="mx-auto grid max-w-3xl gap-5">
      <Step n={1} title="Paste a job">
        <p className="mb-3 text-[15px] text-muted">
          Jordan, a new grad in Austin who doesn&apos;t need visa sponsorship, pastes this posting. (Both are made up.)
        </p>
        <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-2xl bg-paper p-4 font-sans text-sm leading-relaxed text-ink">
          {EXAMPLE_POSTING}
        </pre>
      </Step>

      <Step n={2} title="See if it's worth applying">
        <p className="mb-4 text-[15px] text-muted">
          Claude reads the posting once. Then plain code checks it against Jordan&apos;s must-haves and experience. This check is the
          real one, running in your browser now.
        </p>
        {a ? (
          <ApplyVerdict decision={a.decision} skills={a.skills} />
        ) : error ? (
          <p className="text-sm text-bad">{error}</p>
        ) : (
          <Spinner label="Checking the example job..." />
        )}
      </Step>

      <Step n={3} title="Get a tailored resume">
        <p className="mb-5 text-[15px] text-muted">
          One page, written only from Jordan&apos;s experience and reordered for this job. Anything that isn&apos;t in the experience
          would be flagged and left out unless Jordan ticks it. Download it as a Word file.
        </p>
        <SampleResume />
      </Step>

      <section className="rounded-[22px] bg-white p-6 text-center shadow-soft sm:p-8">
        <p className="text-[21px] font-semibold tracking-display">Try it with your own jobs.</p>
        <p className="mt-2 text-[15px] text-muted">
          Setup takes about 5 minutes. About 1 to 2¢ to check a job and about 5¢ to tailor, paid to Anthropic with your own key.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <Link href="/onboarding" className={primaryLinkClass}>
            Start setup
          </Link>
          <Link href="/privacy" className={secondaryLinkClass}>
            How your data is handled
          </Link>
        </div>
      </section>
    </div>
  );
}
