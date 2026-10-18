"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { getSettings } from "@/lib/db";
import { resumeWriter } from "@/lib/ai/route";
import type { ProviderId } from "@/lib/ai/provider";

/** Who writes resumes right now (Settings > OpenAI API key), live. Claude until settings load. */
export function useResumeWriter(): ProviderId {
  return useLiveQuery(async () => resumeWriter(await getSettings()), []) ?? "anthropic";
}
