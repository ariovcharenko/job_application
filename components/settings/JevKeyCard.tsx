"use client";

import { useEffect, useRef, useState } from "react";
import { getSettings, saveSettings } from "@/lib/db";
import { testJevConnection } from "@/lib/ai/jev";
import { useAutosave } from "@/lib/useAutosave";
import { API_KEYS_FORGOTTEN_EVENT } from "@/lib/wipe";
import { Button, Card, Field, Notice } from "@/components/ui";

type Status = { kind: "ok" | "error" | "info"; text: string } | null;

/**
 * Optional Jev (TypeSafe) key for the instant early read of a posting. Autosaves its own field
 * only, so it never overwrites the other key cards.
 */
export default function JevKeyCard() {
  const { draft: s, setDraft: setS, status: saveStatus } = useAutosave(getSettings, async (v) => {
    await saveSettings({ jevKey: (v.jevKey ?? "").trim() });
  });
  const [status, setStatus] = useState<Status>(null);
  const [busy, setBusy] = useState(false);

  const latest = useRef(s);
  latest.current = s;
  useEffect(() => {
    const onForgot = () => {
      if (latest.current) setS({ ...latest.current, jevKey: "" });
    };
    window.addEventListener(API_KEYS_FORGOTTEN_EVENT, onForgot);
    return () => window.removeEventListener(API_KEYS_FORGOTTEN_EVENT, onForgot);
  }, [setS]);

  if (!s) return null;
  const key = (s.jevKey ?? "").trim();

  const test = async () => {
    setBusy(true);
    setStatus({ kind: "info", text: "Testing..." });
    const r = await testJevConnection(key);
    setStatus({ kind: r.ok ? "ok" : "error", text: r.message });
    setBusy(false);
  };

  const forget = () => {
    setS({ ...s, jevKey: "" });
    setStatus({ kind: "ok", text: "Your Jev key was removed from this browser." });
  };

  return (
    <Card
      title="Jev API key"
      hint="Optional. Gives an instant early read of a posting (visa wording, work style, interview focus) while the full check runs. Checks, scores and resumes never depend on it."
      saveStatus={saveStatus}
    >
      <div className="grid gap-4">
        <Field label="API key" type="password" placeholder="Paste your Jev key from TypeSafe" value={s.jevKey ?? ""} onChange={(v) => setS({ ...s, jevKey: v })} />
        <p className="text-[13px] text-muted">
          Your Jev key is stored only in this browser and uses your own TypeSafe credits. When the app asks Jev a question, the key and the job text pass through this app&apos;s server on the way to TypeSafe. When you tailor a resume, the changed bullets and the matching lines from Your experience are also sent to Jev to check the wording.
          Nothing is stored or logged.
        </p>
        <div className="flex flex-wrap gap-3">
          <Button variant="secondary" onClick={test} disabled={busy || !key}>
            Test key
          </Button>
          <Button variant="secondary" onClick={forget} disabled={busy || !key}>
            Forget key
          </Button>
        </div>
      </div>
      <div aria-live="polite">{status && <Notice kind={status.kind}>{status.text}</Notice>}</div>
    </Card>
  );
}
