"use client";

import { useEffect, useRef, useState } from "react";
import { getSettings, saveSettings } from "@/lib/db";
import { createAnthropicProvider } from "@/lib/ai/anthropic";
import { MODEL_OPTIONS, type ModelOption } from "@/lib/options";
import { useAutosave } from "@/lib/useAutosave";
import { API_KEYS_FORGOTTEN_EVENT } from "@/lib/wipe";
import { Button, Card, Field, Notice, SaveIndicator, SelectField } from "@/components/ui";

type Status = { kind: "ok" | "error" | "info"; text: string } | null;

export default function ApiKeyCard({
  onSaved,
  compact = false,
}: {
  /** Called after each save with the key now stored (used to resume an analysis once a key is added). */
  onSaved?: (key: string) => void;
  /** Tucks the workspace and model choices under "More options" (the in-flow key panel). */
  compact?: boolean;
} = {}) {
  const onSavedRef = useRef(onSaved);
  onSavedRef.current = onSaved;
  const {
    draft: s,
    setDraft: setS,
    status: saveStatus,
  } = useAutosave(getSettings, async (v) => {
    await saveSettings({
      anthropicKey: v.anthropicKey.trim(),
      workspaceId: v.workspaceId.trim(),
      fastModel: v.fastModel,
      smartModel: v.smartModel,
    });
    onSavedRef.current?.(v.anthropicKey.trim());
  });
  const [status, setStatus] = useState<Status>(null);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState<ModelOption[]>([]);

  // "Forget my API key" (Backup card) clears the stored key. Clear the field too, so a later edit
  // here doesn't quietly save the old key again.
  const latest = useRef(s);
  latest.current = s;
  useEffect(() => {
    const onForgot = () => {
      if (latest.current) setS({ ...latest.current, anthropicKey: "" });
    };
    window.addEventListener(API_KEYS_FORGOTTEN_EVENT, onForgot);
    return () => window.removeEventListener(API_KEYS_FORGOTTEN_EVENT, onForgot);
  }, [setS]);

  if (!s) return null;

  // Built-in list, plus anything found on the account, plus whatever is currently saved.
  const options: ModelOption[] = [...MODEL_OPTIONS];
  for (const m of [...loaded, { id: s.fastModel, label: s.fastModel }, { id: s.smartModel, label: s.smartModel }]) {
    if (m.id && !options.some((o) => o.id === m.id)) options.push(m);
  }
  const modelChoices = options.map((o) => ({ value: o.id, label: o.label }));

  const provider = () =>
    createAnthropicProvider({
      apiKey: s.anthropicKey.trim(),
      workspaceId: s.workspaceId,
      fastModel: s.fastModel,
      smartModel: s.smartModel,
    });

  const test = async () => {
    setBusy(true);
    setStatus({ kind: "info", text: "Testing..." });
    const r = await provider().testConnection();
    setStatus({ kind: r.ok ? "ok" : "error", text: r.message });
    setBusy(false);
  };

  const loadModels = async () => {
    setBusy(true);
    setStatus({ kind: "info", text: "Loading models from your account..." });
    try {
      const found = await provider().listModels();
      setLoaded(found.map((m) => ({ id: m.id, label: m.label })));
      setStatus({ kind: "ok", text: `Found ${found.length} Claude model(s) available to this key.` });
    } catch (e) {
      setStatus({ kind: "error", text: e instanceof Error ? e.message : String(e) });
    }
    setBusy(false);
  };

  const advanced = (
    <>
      <Field
        label="Workspace ID (only if you see a “not scoped to a workspace” error)"
        placeholder="wrkspc_..."
        value={s.workspaceId}
        onChange={(v) => setS({ ...s, workspaceId: v })}
      />
      <div className="grid gap-4 sm:grid-cols-2">
        <SelectField
          label="Fast model (reading and checking jobs)"
          value={s.fastModel}
          onChange={(v) => setS({ ...s, fastModel: v })}
          options={modelChoices}
        />
        <SelectField
          label="Smart model (tailoring, writing)"
          value={s.smartModel}
          onChange={(v) => setS({ ...s, smartModel: v })}
          options={modelChoices}
        />
      </div>
    </>
  );

  return (
    <Card
      title="Anthropic API key"
      hint="Stored only in this browser and sent only to Anthropic, never to any other server. Use a key with a monthly spend limit."
    >
      <div className="grid gap-4">
        <Field
          label="API key"
          type="password"
          placeholder="sk-ant-..."
          value={s.anthropicKey}
          onChange={(v) => setS({ ...s, anthropicKey: v })}
        />
        {compact ? (
          <details className="text-sm">
            <summary className="cursor-pointer text-[13px] font-medium text-muted hover:text-ink">More options (workspace, models)</summary>
            <div className="mt-3 grid gap-4">{advanced}</div>
          </details>
        ) : (
          advanced
        )}
        <div className="flex flex-wrap gap-3">
          <Button variant="secondary" onClick={test} disabled={busy || !s.anthropicKey.trim()}>
            Test connection
          </Button>
          {!compact && (
            <Button variant="secondary" onClick={loadModels} disabled={busy || !s.anthropicKey.trim()}>
              Load my models
            </Button>
          )}
        </div>
      </div>
      {status && <Notice kind={status.kind}>{status.text}</Notice>}
      <SaveIndicator status={saveStatus} />
    </Card>
  );
}
