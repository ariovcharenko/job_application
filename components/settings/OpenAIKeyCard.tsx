"use client";

import { useEffect, useRef, useState } from "react";
import { getSettings, saveSettings } from "@/lib/db";
import { createOpenAIProvider } from "@/lib/ai/openai";
import { resumeWriter } from "@/lib/ai/route";
import type { ProviderId } from "@/lib/ai/provider";
import { DEFAULT_OPENAI_MODEL, OPENAI_MODEL_OPTIONS, type ModelOption } from "@/lib/options";
import { useAutosave } from "@/lib/useAutosave";
import { API_KEYS_FORGOTTEN_EVENT } from "@/lib/wipe";
import { Button, Card, Field, Notice, SelectField, labelClass } from "@/components/ui";

type Status = { kind: "ok" | "error" | "info"; text: string } | null;

const WRITERS: { id: ProviderId; label: string }[] = [
  { id: "anthropic", label: "Claude" },
  { id: "openai", label: "OpenAI" },
];

/**
 * Optional OpenAI key, used only to write and revise resumes (lib/ai/route.ts). Autosaves its own
 * fields only, so it never overwrites the Anthropic card's.
 */
export default function OpenAIKeyCard({
  compact = false,
  onSaved,
}: {
  /** Hides the model picker under "More options" (onboarding, the in-flow key panel). */
  compact?: boolean;
  /** Called after each save with the key now stored. */
  onSaved?: (key: string) => void;
} = {}) {
  const onSavedRef = useRef(onSaved);
  onSavedRef.current = onSaved;
  const {
    draft: s,
    setDraft: setS,
    status: saveStatus,
  } = useAutosave(getSettings, async (v) => {
    await saveSettings({
      openaiKey: (v.openaiKey ?? "").trim(),
      openaiModel: v.openaiModel?.trim() || DEFAULT_OPENAI_MODEL,
      resumeWriter: v.resumeWriter ?? "auto",
    });
    onSavedRef.current?.((v.openaiKey ?? "").trim());
  });
  const [status, setStatus] = useState<Status>(null);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState<ModelOption[]>([]);

  const latest = useRef(s);
  latest.current = s;
  useEffect(() => {
    const onForgot = () => {
      if (latest.current) setS({ ...latest.current, openaiKey: "" });
    };
    window.addEventListener(API_KEYS_FORGOTTEN_EVENT, onForgot);
    return () => window.removeEventListener(API_KEYS_FORGOTTEN_EVENT, onForgot);
  }, [setS]);

  if (!s) return null;

  const key = (s.openaiKey ?? "").trim();
  const model = s.openaiModel?.trim() || DEFAULT_OPENAI_MODEL;
  const writer = resumeWriter(s);

  // The account's own list once loaded, else the short built-in one; plus whatever is saved.
  const options: ModelOption[] = loaded.length ? [...loaded] : [...OPENAI_MODEL_OPTIONS];
  if (!options.some((o) => o.id === model)) options.unshift({ id: model, label: model });

  const provider = () => createOpenAIProvider({ apiKey: key, model });

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
      setLoaded(found);
      setStatus({ kind: "ok", text: `Found ${found.length} OpenAI model(s) this key can use for writing.` });
    } catch (e) {
      setStatus({ kind: "error", text: e instanceof Error ? e.message : String(e) });
    }
    setBusy(false);
  };

  const forget = () => {
    setS({ ...s, openaiKey: "" });
    setStatus({ kind: "ok", text: "Your OpenAI key was removed from this browser. Resumes are written with Claude." });
  };

  const modelPicker = (
    <SelectField
      label="OpenAI model (writing resumes)"
      value={model}
      onChange={(v) => setS({ ...s, openaiModel: v })}
      options={options.map((o) => ({ value: o.id, label: o.label }))}
    />
  );

  return (
    <Card
      title="OpenAI API key"
      hint="Optional. Used only to write and revise resumes. Stored in this browser and sent only to OpenAI. Checking jobs, reading links and importing resumes always use Claude."
      saveStatus={saveStatus}
    >
      <div className="grid gap-4">
        <div role="radiogroup" aria-label="Write and revise resumes with">
          <span className={labelClass}>Write and revise resumes with</span>
          <div className="inline-flex rounded-full bg-black/[0.05] p-1">
            {WRITERS.map((w) => (
              <button
                key={w.id}
                type="button"
                role="radio"
                aria-checked={writer === w.id}
                onClick={() => setS({ ...s, resumeWriter: w.id })}
                className={`rounded-full px-4 py-1.5 text-[14px] font-medium transition focus:outline-none focus-visible:ring-4 focus-visible:ring-accent/25 ${
                  writer === w.id ? "bg-white text-ink shadow-soft" : "text-muted hover:text-ink"
                }`}
              >
                {w.label}
              </button>
            ))}
          </div>
          {writer === "openai" && !key && (
            <p className="mt-2 text-[13px] text-muted">Add an OpenAI key below. Until then, tailoring asks before using Claude instead.</p>
          )}
        </div>
        <Field label="API key" type="password" placeholder="Paste your OpenAI key" value={s.openaiKey ?? ""} onChange={(v) => setS({ ...s, openaiKey: v })} />
        {compact ? (
          <details className="text-sm">
            <summary className="cursor-pointer text-[13px] font-medium text-muted hover:text-ink">More options (model)</summary>
            <div className="mt-3 grid gap-4">{modelPicker}</div>
          </details>
        ) : (
          modelPicker
        )}
        <div className="flex flex-wrap gap-3">
          <Button variant="secondary" onClick={test} disabled={busy || !key}>
            Test connection
          </Button>
          {!compact && (
            <Button variant="secondary" onClick={loadModels} disabled={busy || !key}>
              Load my models
            </Button>
          )}
          {!compact && (
            <Button variant="secondary" onClick={forget} disabled={busy || !key}>
              Forget key
            </Button>
          )}
        </div>
      </div>
      <div aria-live="polite">{status && <Notice kind={status.kind}>{status.text}</Notice>}</div>
    </Card>
  );
}
