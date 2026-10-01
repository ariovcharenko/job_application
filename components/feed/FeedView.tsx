"use client";

import { useLiveQuery } from "dexie-react-hooks";
import Link from "next/link";
import { useEffect, useState } from "react";
import { getProvider } from "@/lib/ai";
import { AIError } from "@/lib/ai/provider";
import { db, getPreferences, getSettings } from "@/lib/db";
import { runDiscovery, type DiscoveryOutcome, type DiscoveryProgress } from "@/lib/discovery/pipeline";
import { dismissFeedItem, startApplicationFromFeed } from "@/lib/tracker/repo";
import { pickStrongMatches } from "@/lib/resume/batch";
import type { FeedItem, Preferences } from "@/lib/types";
import { Button, ChipSelect, EmptyState, Notice, PageHeader } from "@/components/ui";
import BatchTailorPanel from "./BatchTailorPanel";
import FeedItemCard from "./FeedItemCard";

export default function FeedView() {
  const items = useLiveQuery(() => db.feed.orderBy("fitScore").reverse().toArray(), []);
  const [prefs, setPrefs] = useState<Preferences | null>(null);
  const [companyOptions, setCompanyOptions] = useState<string[] | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<DiscoveryProgress[]>([]);
  const [outcome, setOutcome] = useState<DiscoveryOutcome | null>(null);
  const [error, setError] = useState<{ message: string; needsSettings: boolean } | null>(null);
  const [showDismissed, setShowDismissed] = useState(false);

  // Load the watchlist once the component mounts in the browser. IndexedDB doesn't exist during
  // server-side rendering, so this must never run in the render body itself.
  useEffect(() => {
    let alive = true;
    getPreferences().then((p) => {
      if (!alive) return;
      setPrefs(p);
      setCompanyOptions(p.companyWatchlist);
      setSelected(p.companyWatchlist);
    });
    return () => {
      alive = false;
    };
  }, []);

  const search = async () => {
    setError(null);
    setOutcome(null);
    setProgress([]);
    if (selected.length === 0) {
      setError({ message: "Select at least one company to search.", needsSettings: false });
      return;
    }
    setRunning(true);
    try {
      const settings = await getSettings();
      if (!settings.jsearchApiKey.trim()) {
        throw new AIError("no_key", "Add your JSearch API key in Settings first.");
      }
      const [prefs, provider] = await Promise.all([getPreferences(), getProvider()]);
      const result = await runDiscovery(selected, prefs, settings.jsearchApiKey, provider, (p) =>
        setProgress((log) => [...log.slice(-4), p]),
      );
      setOutcome(result);
    } catch (e) {
      const needsSettings = e instanceof AIError && e.kind === "no_key";
      setError({ message: e instanceof Error ? e.message : String(e), needsSettings });
    } finally {
      setRunning(false);
    }
  };

  const visible = (items ?? []).filter((i) => showDismissed || i.state !== "dismissed");
  const dismissedCount = (items ?? []).filter((i) => i.state === "dismissed").length;
  const strongMatches = prefs ? pickStrongMatches(items ?? [], prefs) : [];

  return (
    <>
      <PageHeader
        title="Feed"
        subtitle="Searches the companies below and scores new postings against your Preferences. Nothing runs until you click Search now."
      />

      {companyOptions && (
        <div className="mb-6 rounded-[22px] bg-white p-5 shadow-soft">
          <ChipSelect
            label="Search these companies"
            hint="Fewer companies means fewer JSearch requests spent. Edit your full watchlist in Settings."
            options={companyOptions}
            value={selected}
            onChange={setSelected}
          />
          <div className="mt-5 flex flex-wrap items-center gap-3 border-t border-black/[0.06] pt-4">
            <Button onClick={search} disabled={running}>
              {running ? "Searching..." : "Search now"}
            </Button>
            <span className="text-xs text-muted">
              Up to {selected.length} JSearch request{selected.length === 1 ? "" : "s"}, plus one AI call per new
              posting that matches a target role.
            </span>
          </div>

          {running && progress.length > 0 && (
            <ul className="mt-3 text-sm text-black/60">
              {progress.map((p, i) => (
                <li key={i}>
                  {p.company}: {p.status}
                  {p.detail ? `: ${p.detail}` : ""}
                </li>
              ))}
            </ul>
          )}

          {error && (
            <Notice kind="error">
              {error.message}
              {error.needsSettings && (
                <>
                  {" "}
                  <Link href="/settings" className="underline">
                    Go to Settings
                  </Link>
                  .
                </>
              )}
            </Notice>
          )}

          {outcome && (
            <Notice kind="ok">
              Found {outcome.found}, added {outcome.added} new match{outcome.added === 1 ? "" : "es"}
              {outcome.skippedExisting > 0 && `, ${outcome.skippedExisting} already known`}
              {outcome.skippedIrrelevant > 0 && `, ${outcome.skippedIrrelevant} not a match for your target roles`}
              {outcome.skippedOtherCompany > 0 && `, ${outcome.skippedOtherCompany} from other companies`}.
              {outcome.requestsRemaining !== null && ` About ${outcome.requestsRemaining} JSearch requests left this month.`}
              {outcome.errors.length > 0 && (
                <>
                  {" "}
                  {outcome.errors.length} error{outcome.errors.length === 1 ? "" : "s"}: {outcome.errors.map((e) => `${e.company} (${e.message})`).join("; ")}
                </>
              )}
            </Notice>
          )}
        </div>
      )}

      <BatchTailorPanel matches={strongMatches} />

      {items === undefined ? null : visible.length === 0 ? (
        <EmptyState title="No matches yet">Pick some companies above and click Search now.</EmptyState>
      ) : (
        <div className="grid gap-3">
          {visible.map((item) => (
            <FeedItemCard
              key={item.id}
              item={item}
              onStart={(i) => startApplicationFromFeed(i)}
              onDismiss={(id) => dismissFeedItem(id)}
            />
          ))}
        </div>
      )}

      {dismissedCount > 0 && (
        <button type="button" onClick={() => setShowDismissed((v) => !v)} className="mt-4 text-sm text-muted underline">
          {showDismissed ? "Hide" : "Show"} {dismissedCount} dismissed
        </button>
      )}
    </>
  );
}
