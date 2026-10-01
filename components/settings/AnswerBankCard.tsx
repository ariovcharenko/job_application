"use client";

import { useEffect, useRef, useState } from "react";
import { deleteAnswerBankEntry, getAnswerBank, saveAnswerBankEntry } from "@/lib/db";
import type { AnswerBankEntry } from "@/lib/types";
import type { SaveStatus } from "@/lib/useAutosave";
import { Button, Card, ConfirmDialog, inputClass, TextArea } from "@/components/ui";

const SAVE_DELAY_MS = 300;

export default function AnswerBankCard() {
  const [entries, setEntries] = useState<AnswerBankEntry[] | null>(null);
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<AnswerBankEntry | null>(null);
  const [status, setStatus] = useState<SaveStatus>("idle");
  // Edits show at once and are written shortly after typing stops (one timer per answer). Writing
  // and re-reading on every keystroke made the controlled inputs lag and could drop characters.
  const pending = useRef(new Map<number, { entry: AnswerBankEntry; timer: ReturnType<typeof setTimeout> }>());

  useEffect(() => {
    void getAnswerBank().then(setEntries);
    const queue = pending.current;
    return () => {
      // Leaving the page: write whatever is still waiting.
      for (const { entry, timer } of queue.values()) {
        clearTimeout(timer);
        void saveAnswerBankEntry(entry);
      }
      queue.clear();
    };
  }, []);

  const update = (entry: AnswerBankEntry, patch: Partial<AnswerBankEntry>) => {
    if (entry.id === undefined) return;
    const next = { ...entry, ...patch };
    setEntries((list) => list?.map((e) => (e.id === next.id ? next : e)) ?? list);
    setStatus("saving");
    const id = next.id!;
    clearTimeout(pending.current.get(id)?.timer);
    const timer = setTimeout(async () => {
      pending.current.delete(id);
      await saveAnswerBankEntry(next);
      if (pending.current.size === 0) setStatus("saved");
    }, SAVE_DELAY_MS);
    pending.current.set(id, { entry: next, timer });
  };

  const remove = async (id?: number) => {
    if (id === undefined) return;
    clearTimeout(pending.current.get(id)?.timer);
    pending.current.delete(id);
    await deleteAnswerBankEntry(id);
    setEntries((list) => list?.filter((e) => e.id !== id) ?? list);
  };

  const add = async () => {
    setAdding(true);
    try {
      const entry: AnswerBankEntry = { question: "", answer: "", tags: [] };
      const id = await saveAnswerBankEntry(entry);
      setEntries((list) => [...(list ?? []), { ...entry, id }]);
    } finally {
      setAdding(false);
    }
  };

  if (!entries) return null;

  return (
    <Card title="Answer bank" hint="Reusable answers for applications and outreach. Drafts use only what's here." saveStatus={status}>
      <div className="grid gap-3">
        {entries.map((e, i) => (
          <div key={e.id} className="rounded-2xl border border-black/[0.08] p-4">
            <div className="flex items-start justify-between gap-3">
              <input
                value={e.question}
                onChange={(ev) => update(e, { question: ev.target.value })}
                placeholder="Question, e.g. Why do you want to work here?"
                aria-label={`Question ${i + 1}`}
                className={`${inputClass} font-medium`}
              />
              <Button variant="danger-quiet" onClick={() => (e.question.trim() || e.answer.trim() ? setRemoving(e) : void remove(e.id))}>
                Remove
              </Button>
            </div>
            <div className="mt-3">
              <TextArea label="Answer" value={e.answer} onChange={(v) => update(e, { answer: v })} rows={3} />
            </div>
          </div>
        ))}
        {entries.length === 0 && <p className="text-sm text-muted">No answers yet.</p>}
      </div>
      <div className="mt-4">
        <Button variant="secondary" onClick={add} disabled={adding}>
          Add answer
        </Button>
      </div>
      {removing && (
        <ConfirmDialog
          title="Remove this answer?"
          message={removing.question.trim() ? `"${removing.question.trim()}" and its answer will be deleted.` : "This answer will be deleted."}
          confirmLabel="Remove"
          onCancel={() => setRemoving(null)}
          onConfirm={async () => {
            await remove(removing.id);
            setRemoving(null);
          }}
        />
      )}
    </Card>
  );
}
