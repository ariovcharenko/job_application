"use client";

import { useState } from "react";
import { getSettings, saveSettings } from "@/lib/db";
import { searchJobs } from "@/lib/discovery/jsearch";
import { useAutosave } from "@/lib/useAutosave";
import { Button, Card, Field, Notice, SaveIndicator } from "@/components/ui";

export default function JSearchKeyCard() {
  const { draft: s, setDraft: setS, status } = useAutosave(getSettings, (v) => saveSettings({ jsearchApiKey: v.jsearchApiKey.trim() }));
  const [testStatus, setTestStatus] = useState<{ kind: "ok" | "error" | "info"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  if (!s) return null;

  const test = async () => {
    setBusy(true);
    setTestStatus({ kind: "info", text: "Testing..." });
    try {
      const result = await searchJobs(s.jsearchApiKey, "software engineer");
      const quota = result.requestsRemaining !== null ? ` About ${result.requestsRemaining} requests left this month.` : "";
      setTestStatus({ kind: "ok", text: `Connected. Found ${result.postings.length} result(s) for a test search.${quota}` });
    } catch (e) {
      setTestStatus({ kind: "error", text: e instanceof Error ? e.message : String(e) });
    }
    setBusy(false);
  };

  return (
    <Card
      title="Job search API (JSearch)"
      hint={
        <>
          Powers the company-watchlist feed on the Feed page, including companies like Amazon and Microsoft that don't
          run a public job board of their own. Free for casual use (about 200 searches/month). To set it up:
          <ol className="mt-2 list-decimal space-y-1 pl-5">
            <li>
              Open{" "}
              <a href="https://rapidapi.com/letscrape-6bRBa3QguO5/api/jsearch" target="_blank" rel="noopener noreferrer" className="underline">
                rapidapi.com/letscrape-6bRBa3QguO5/api/jsearch
              </a>{" "}
              and check that the page title says exactly <strong>&quot;JSearch&quot;</strong> by publisher{" "}
              <strong>letscrape-6bRBa3QguO5</strong>. RapidAPI has several similarly-named job-search APIs from other
              publishers (e.g. &quot;JSearch (Mega)&quot;, &quot;Job search API&quot;). Subscribing to one of those instead
              will look like it worked but every search will fail with a confusing error, since it's a different API
              entirely.
            </li>
            <li>Sign in or create a free RapidAPI account.</li>
            <li>Click the green <strong>Subscribe to Test</strong> button, then pick the <strong>Basic (free)</strong> plan.</li>
            <li>
              On the page that opens, find your key: the long value next to <strong>X-RapidAPI-Key</strong> in the
              code sample on the right (under any language tab, e.g. cURL or JavaScript).
            </li>
            <li>Paste that key below and click "Test connection" to confirm it works before it's used for real searches.</li>
          </ol>
          Stored only in this browser.
        </>
      }
    >
      <div className="grid gap-4 max-w-md">
        <Field label="JSearch API key" type="password" placeholder="Your RapidAPI key" value={s.jsearchApiKey} onChange={(v) => setS({ ...s, jsearchApiKey: v })} />
      </div>
      <div className="mt-3">
        <Button variant="secondary" onClick={test} disabled={busy || !s.jsearchApiKey.trim()}>
          Test connection
        </Button>
      </div>
      {testStatus && <Notice kind={testStatus.kind}>{testStatus.text}</Notice>}
      <SaveIndicator status={status} />
    </Card>
  );
}
