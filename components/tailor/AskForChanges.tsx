"use client";

import { useState } from "react";
import { Button, inputClass } from "@/components/ui";
import { CHANGE_CHIPS } from "@/lib/resume/engine/revise";

/**
 * The chat-style box: type what should change, or click a chip, and it runs right away as one
 * revision. Anything new it adds that isn't in her experience still needs her OK on the page.
 */
export default function AskForChanges({
  onSend,
  busy,
  disabled,
  cost,
  changes,
}: {
  onSend: (note: string) => void;
  busy: boolean;
  disabled?: boolean;
  cost: string;
  /** What the last revision did, one line per request. */
  changes: string[];
}) {
  const [text, setText] = useState("");
  const send = (note: string) => {
    if (!note.trim() || disabled) return;
    onSend(note.trim());
    setText("");
  };

  return (
    <section className="rounded-2xl bg-paper p-5" aria-labelledby="ask-heading">
      <h3 id="ask-heading" className="text-[15px] font-semibold tracking-display">
        Ask for changes
      </h3>
      <div className="mt-3 flex flex-wrap gap-2">
        {CHANGE_CHIPS.map((c) => (
          <button
            key={c.label}
            type="button"
            disabled={disabled}
            onClick={() => send(c.note)}
            className="rounded-full border border-black/[0.1] bg-white px-3 py-1 text-[13px] transition hover:border-accent hover:text-accent disabled:opacity-40"
          >
            {c.label}
          </button>
        ))}
      </div>
      <textarea
        rows={2}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) send(text);
        }}
        placeholder="e.g. Lead with the payments work and mention the Grafana dashboards"
        aria-label="What should change"
        className={`${inputClass} mt-3 text-sm sm:text-sm`}
      />
      <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-muted">Runs right away. Click any line on the page for changes to just that line.</p>
        <Button onClick={() => send(text)} disabled={disabled || !text.trim()}>
          {busy ? "Updating..." : `Send (${cost})`}
        </Button>
      </div>
      {changes.length > 0 && (
        <div className="mt-3 rounded-xl bg-white p-3 text-sm">
          <p className="mb-1 font-medium">What changed</p>
          <ul className="list-disc pl-5 text-muted">
            {changes.map((c, i) => (
              <li key={i}>{c}</li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
