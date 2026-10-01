"use client";

import { useEffect, useState } from "react";
import { deleteAnswerBankEntry, getAnswerBank, saveAnswerBankEntry } from "@/lib/db";
import type { AnswerBankEntry } from "@/lib/types";
import { Button, Card, ConfirmDialog, inputClass, TextArea } from "@/components/ui";

export default function AnswerBankCard() {
  const [entries, setEntries] = useState<AnswerBankEntry[] | null>(null);
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<AnswerBankEntry | null>(null);

  const refresh = async () => setEntries(await getAnswerBank());
  useEffect(() => {
    refresh();
  }, []);

  const update = async (entry: AnswerBankEntry, patch: Partial<AnswerBankEntry>) => {
    await saveAnswerBankEntry({ ...entry, ...patch });
    await refresh();
  };

  const remove = async (id?: number) => {
    if (id === undefined) return;
    await deleteAnswerBankEntry(id);
    await refresh();
  };

  const add = async () => {
    setAdding(true);
    await saveAnswerBankEntry({ question: "", answer: "", tags: [] });
    await refresh();
    setAdding(false);
  };

  if (!entries) return null;

  return (
    <Card
      title="Answer bank"
      hint="Reusable answers to common application and outreach questions (why this company, your strengths, a project you're proud of). Tailoring and outreach drafts pull from these for authentic, specific writing. The AI uses only what's here and never invents facts about you."
    >
      <div className="grid gap-3">
        {entries.map((e) => (
          <div key={e.id} className="rounded-md border border-black/10 p-3">
            <div className="flex items-start justify-between gap-3">
              <input
                value={e.question}
                onChange={(ev) => update(e, { question: ev.target.value })}
                placeholder="Question (e.g. Why do you want to work here?)"
                className={`${inputClass} font-medium`}
              />
              <Button variant="danger-quiet" onClick={() => (e.question.trim() || e.answer.trim() ? setRemoving(e) : void remove(e.id))}>
                Remove
              </Button>
            </div>
            <div className="mt-2">
              <TextArea label="Answer" value={e.answer} onChange={(v) => update(e, { answer: v })} rows={2} />
            </div>
          </div>
        ))}
        {entries.length === 0 && <p className="text-sm text-muted">No answers saved yet.</p>}
      </div>
      <div className="mt-3">
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
