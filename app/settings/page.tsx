import type { Metadata } from "next";
import AnswerBankCard from "@/components/settings/AnswerBankCard";
import BackupCard from "@/components/settings/BackupCard";
import JSearchKeyCard from "@/components/settings/JSearchKeyCard";
import ApiKeyCard from "@/components/settings/ApiKeyCard";
import PreferencesCard from "@/components/settings/PreferencesCard";
import ProfileCard from "@/components/settings/ProfileCard";
import SettingsNav from "@/components/settings/SettingsNav";
import { PageHeader } from "@/components/ui";
import { FEATURES } from "@/lib/features";

export const metadata: Metadata = { title: "Settings" };

// Titles must match each card's <Card title>, since the anchors are derived from them.
const SECTIONS = [
  "Anthropic API key",
  "Profile",
  "Job preferences",
  "Answer bank",
  ...(FEATURES.jobFeed ? ["Job search API (JSearch)"] : []),
  "Backup and restore",
];

export default function SettingsPage() {
  return (
    <>
      <PageHeader title="Settings" subtitle="Saves automatically and stays in this browser." />
      <div className="grid gap-8 lg:grid-cols-[200px_minmax(0,1fr)]">
        <SettingsNav sections={SECTIONS} />
        <div className="min-w-0 max-w-4xl">
          <ApiKeyCard />
          <ProfileCard />
          <PreferencesCard />
          <AnswerBankCard />
          {FEATURES.jobFeed && <JSearchKeyCard />}
          <BackupCard />
        </div>
      </div>
    </>
  );
}
