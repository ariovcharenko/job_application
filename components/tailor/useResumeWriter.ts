"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { getSettings } from "@/lib/db";
import { resumeWriter } from "@/lib/ai/route";
import type { ProviderId } from "@/lib/ai/provider";
import { DEFAULT_OPENAI_MODEL } from "@/lib/options";

/** Who writes resumes right now (Settings > OpenAI API key), live. Claude until settings load. */
export function useResumeWriter(): ProviderId {
  return useLiveQuery(async () => resumeWriter(await getSettings()), []) ?? "anthropic";
}

/** "OpenAI (gpt-5)" or "Claude (claude-sonnet-5)": who writes this run, shown on the tailoring screen. */
export function useWriterLabel(override?: ProviderId): string | null {
  return (
    useLiveQuery(async () => {
      const s = await getSettings();
      const id = override ?? resumeWriter(s);
      return id === "openai" ? `OpenAI (${s.openaiModel?.trim() || DEFAULT_OPENAI_MODEL})` : `Claude (${s.smartModel})`;
    }, [override]) ?? null
  );
}
