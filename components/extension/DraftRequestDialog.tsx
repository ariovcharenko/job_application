"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { getProvider } from "@/lib/ai";
import { describeAIError } from "@/lib/ai/errors";
import { getAnswerBank, getMasterProfile, getProfile } from "@/lib/db";
import { draftApplicationAnswer, isLegalQuestion, LEGAL_REFUSAL } from "@/lib/extension/draftAnswer";
import { finishDraftRequest, nextDraftRequest, subscribeHub } from "@/lib/extension/hub";
import { Button, Modal, Notice, Spinner, TextArea } from "@/components/ui";

/**
 * The extension asked for a draft answer to a question on an application form. Nothing is spent
 * until she clicks "Write a draft", and the answer goes back to the form only when she clicks
 * "Send to the form" (decision #6 spirit: she approves every word).
 */
export default function DraftRequestDialog() {
  const request = useSyncExternalStore(subscribeHub, nextDraftRequest, () => undefined);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setText("");
    setError(null);
    setBusy(false);
  }, [request?.requestId]);

  if (!request) return null;
  const legal = isLegalQuestion(request.question);

  const draft = async () => {
    setBusy(true);
    setError(null);
    try {
      const [provider, profile, masterProfile, answerBank] = await Promise.all([getProvider("draft_answer"), getProfile(), getMasterProfile(), getAnswerBank()]);
      setText(await draftApplicationAnswer(provider, { question: request.question, jobText: request.jobText, profile, masterProfile, answerBank }));
    } catch (e) {
      setError(e instanceof Error && e.name !== "AIError" ? e.message : describeAIError(e).message);
    } finally {
      setBusy(false);
    }
  };

  const send = () => {
    if (!finishDraftRequest(request.requestId, text.trim())) setError("Lost the connection to the extension. Open its popup, then try again.");
  };

  return (
    <Modal title="Answer for your application" onClose={() => finishDraftRequest(request.requestId, null)} size="sm">
      <p className="text-sm text-muted">The Chrome extension asked for help with this question:</p>
      <p className="mt-2 rounded-2xl bg-paper p-3 text-sm">{request.question}</p>
      {legal ? (
        <div className="mt-3">
          <Notice kind="info">{LEGAL_REFUSAL}</Notice>
        </div>
      ) : (
        <>
          {!text && (
            <div className="mt-4">
              <Button onClick={draft} disabled={busy}>
                {busy ? "Writing..." : "Write a draft"}
              </Button>
              <p className="mt-2 text-xs text-muted">Uses your saved AI key (a few cents at most). Nothing goes back to the form until you send it.</p>
              {busy && <Spinner label="Writing from your experience..." />}
            </div>
          )}
          {text && (
            <div className="mt-4">
              <TextArea label="Edit it until it sounds like you" value={text} onChange={setText} rows={8} />
              <div className="mt-3 flex gap-3">
                <Button onClick={send}>Send to the form</Button>
                <Button variant="secondary" onClick={draft} disabled={busy}>
                  Write another
                </Button>
              </div>
            </div>
          )}
        </>
      )}
      {error && (
        <div className="mt-3">
          <Notice kind="error">{error}</Notice>
        </div>
      )}
    </Modal>
  );
}
