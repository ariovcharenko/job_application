import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/ui";
import { FEATURES } from "@/lib/features";

export const metadata: Metadata = {
  title: "Privacy",
  description: "What Job Copilot keeps in your browser, what it sends to Anthropic, and what the host sees.",
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
      <PageHeader title="Privacy" subtitle="What stays in your browser, what goes to Anthropic, and what the host sees." />
      <div className="grid gap-4 text-[15px] leading-relaxed text-ink">
        <Section title="Your data lives in this browser">
          <p>
            There is no Job Copilot server and no account. Your Profile, experience, preferences, tracked jobs, tailored resumes, saved
            answers and contacts are stored in this browser&apos;s own database (IndexedDB) on this device. Nobody else can see them,
            including us.
          </p>
          <p className="mt-2 text-muted">
            That also means they aren&apos;t backed up anywhere. Use{" "}
            <Link href="/settings#backup-and-restore" className="text-accent hover:underline">
              Settings, Backup and restore
            </Link>{" "}
            to download a copy. Clearing this site&apos;s data in your browser deletes everything, and so does &quot;Delete all my data&quot;
            in Settings.
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

        <Section title="Pasting a job link">
          <p>
            When you paste a link, Anthropic&apos;s servers open that page (their web fetch tool) and read it. This site never fetches it.
            If a page can&apos;t be read that way, you&apos;ll be asked to paste the description instead.
          </p>
        </Section>

        <Section title="Your API key">
          <p>
            Your Anthropic key is stored in this browser, <strong>unencrypted</strong>, and sent only to Anthropic. Anyone who can use
            this browser profile could read it. So use a key with a monthly spend limit, and don&apos;t save it on a shared computer. You
            can remove it any time with &quot;Forget my API key&quot; in Settings.
          </p>
          <p className="mt-2 text-muted">A backup file leaves the key out unless you tick the box to include it.</p>
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
              If you use the extension, your Profile, saved answers, a resume and your API key are copied into the extension&apos;s own
              storage on this device, so it can fill application forms. It never submits a form for you.
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
