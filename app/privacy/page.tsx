import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/ui";
import { FEATURES } from "@/lib/features";

export const metadata: Metadata = {
  title: "Privacy",
  description: "What Job Copilot keeps in your browser, what it sends to Anthropic or OpenAI, and what the host sees.",
};

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-[22px] bg-white p-6 shadow-soft">
      <h2 className="mb-2 text-[17px] font-semibold tracking-display text-ink">{title}</h2>
      {children}
    </section>
  );
}

export default function PrivacyPage() {
  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title="Privacy" subtitle="What stays in your browser, what goes to Anthropic (and OpenAI, if you add a key), and what the host sees." />
      <div className="grid gap-4 text-[15px] leading-relaxed text-ink">
        <Section title="Your data lives in this browser">
          <p>
            There is no Job Copilot server and no account. Everything you add is stored in this browser&apos;s own database on this
            device. Nobody else can see it, including us.
          </p>
          <p className="mt-2">
            That includes the AI spend meter in Settings: how many tokens each AI answer used, with the model and the kind of task. It is
            worked out and kept here, never sent anywhere.
          </p>
          <p className="mt-2 text-muted">
            It isn&apos;t backed up anywhere unless you use{" "}
            <Link href="/settings#backup-and-restore" className="text-accent hover:underline">
              Backup and restore
            </Link>
            . Clearing this site&apos;s data deletes everything.
          </p>
        </Section>

        <Section title="What is sent to Anthropic">
          <p>AI features call Anthropic&apos;s API directly from your browser, with your own API key. Depending on what you do, that sends:</p>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            <li>
              <strong>Checking a job:</strong> the posting&apos;s text (or its link, see below). The verdict and match are then worked out
              by code in your browser from your Profile and preferences.
            </li>
            <li>
              <strong>Tailoring a resume:</strong> the posting, your experience, and the Profile details that go at the top of a resume
              (name, contact links, education).
            </li>
            <li>
              <strong>Importing your resume:</strong> the file you choose, so it can be turned into your experience.
            </li>
            <li>
              <strong>Drafting outreach:</strong> the job, the contact you entered, your Profile basics and your saved answers.
            </li>
          </ul>
          <p className="mt-2 text-muted">
            Work authorization, sponsorship and EEO answers are used only by code in your browser, never guessed by the AI. Anthropic
            handles API data under its own commercial terms and privacy policy.
          </p>
        </Section>

        <Section title="What is sent to OpenAI (only if you add an OpenAI key)">
          <p>
            OpenAI is optional. If you add an OpenAI key and choose OpenAI to write resumes and messages, then writing and revising a
            tailored resume, and drafting an outreach message, call OpenAI&apos;s API directly from your browser, with your key. That
            sends the job description, your experience, the current resume draft and any change you ask for. For an outreach draft it
            sends the job, the contact&apos;s name and role, your name, school and a few answer bank entries. Nothing else goes to OpenAI.
          </p>
          <p className="mt-2">
            If OpenAI is out of credit, busy or unavailable and an Anthropic key is saved, that same request is sent to Anthropic once instead,
            and the screen says it was written with Claude.
          </p>
          <p className="mt-2 text-muted">
            Checking jobs, reading links and importing your resume always use Anthropic. Every resume OpenAI writes goes through the same
            checks in your browser, so nothing that isn&apos;t in your experience is added without your OK. OpenAI handles API data
            under its own terms and privacy policy.
          </p>
        </Section>

        <Section title="Pasting a job link">
          <p>
            Links to Greenhouse, Lever, Ashby and SmartRecruiters postings are read straight from your browser, from those companies&apos;
            public job listing APIs (the request contains only the posting&apos;s address and no key). For any other link, Anthropic&apos;s
            servers open the page (their web fetch tool) and read it. This site never fetches it. LinkedIn, Indeed and Workday links
            are not read at all: you&apos;ll be asked to paste the description instead, as you will be for any page that can&apos;t be read.
          </p>
        </Section>

        <Section title="Your API key">
          <p>
            Your Anthropic key is stored in this browser, <strong>unencrypted</strong>, and sent only to Anthropic. Anyone using this
            browser profile could read it, so set a monthly spend limit and don&apos;t save it on a shared computer. &quot;Forget my API
            keys&quot; in Settings removes it.
          </p>
          <p className="mt-2">
            An optional OpenAI key is stored the same way, in this browser only, and sent only to OpenAI. &quot;Forget my API keys&quot;
            removes both.
          </p>
          <p className="mt-2 text-muted">A backup file leaves the keys out unless you tick the box to include them.</p>
          {FEATURES.jobFeed && (
            <p className="mt-2 text-muted">
              An optional JSearch (RapidAPI) key is stored the same way and sent only to JSearch, for the company watchlist feed.
            </p>
          )}
        </Section>

        <Section title="What the host sees">
          <p>
            The site is hosted on Vercel, which only serves its files. Like any web host it keeps normal request logs (such as IP address,
            browser and which page was loaded). None of your data is in those requests.
          </p>
          <p className="mt-2">There are no analytics, no trackers, no ads and no cookies.</p>
        </Section>

        <Section title="Your resume folder (optional)">
          <p>
            In Chrome and Edge you can pick a folder for tailored resume files. The app can then read and write files only inside that
            folder, and you can revoke access in your browser&apos;s site settings.
          </p>
        </Section>

        {FEATURES.extension && (
          <Section title="The Chrome extension">
            <p>
              If you connect the Chrome extension, your Profile, saved answers, your experience text, a list of your jobs (company, role and link) and the resume
              file for the job you are applying to are copied into the extension&apos;s own storage on this device, so it can fill application forms. They
              travel only between this site and the extension, never through the page. Your API keys are never sent to it. Free-text answers are drafted
              here in the app, and sent back to the form only after you approve them. The extension never submits a form for you and never runs on
              LinkedIn, Indeed or Jobright.
            </p>
          </Section>
        )}

        <Section title="What the app never does">
          <ul className="list-disc space-y-1 pl-5">
            <li>It never submits a job application for you.</li>
            <li>It never scrapes or automates LinkedIn, Indeed or other job sites.</li>
            <li>It never sends a message for you. Outreach drafts are for you to review and send yourself.</li>
            <li>It never puts a skill, number, employer or date on a tailored resume that isn&apos;t in your experience, unless you tick it.</li>
          </ul>
        </Section>
      </div>
    </div>
  );
}
