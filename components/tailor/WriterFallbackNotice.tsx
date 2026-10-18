"use client";

import { useState } from "react";
import AIErrorNotice from "@/components/resumes/AIErrorNotice";
import OpenAIKeyCard from "@/components/settings/OpenAIKeyCard";
import { AIError } from "@/lib/ai/provider";
import { Button } from "@/components/ui";

/**
 * OpenAI was chosen to write resumes but can't be used right now (no key, rejected key, no credit,
 * a model it can't use). Never a dead end: add or fix the key right here and try again, or use
 * Claude for this run only (the saved choice stays OpenAI).
 */
export default function WriterFallbackNotice({
  error,
  onRetry,
  onUseClaude,
  disabled,
}: {
  error: unknown;
  onRetry: () => void;
  onUseClaude: () => void;
  disabled?: boolean;
}) {
  const [savedKey, setSavedKey] = useState("");
  const keyProblem = error instanceof AIError && (error.kind === "no_key" || error.kind === "auth");
  return (
    <div className="mt-3">
      <AIErrorNotice error={error} />
      {keyProblem && (
        <div className="mt-3">
          <OpenAIKeyCard compact onSaved={setSavedKey} />
        </div>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        {keyProblem && (
          <Button onClick={onRetry} disabled={disabled || !savedKey}>
            Try again with OpenAI
          </Button>
        )}
        <Button variant="secondary" onClick={onUseClaude} disabled={disabled}>
          Use Claude for this run
        </Button>
      </div>
    </div>
  );
}
