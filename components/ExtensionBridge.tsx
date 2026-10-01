"use client";

import { useEffect } from "react";
// Relative imports (not "@/"), so the bridge's logic can be unit-tested under Vitest.
import { getAnswerBank, getBaseResumes, getProfile, getSettings } from "../lib/db";
import { storeCapturedJob } from "../lib/extensionCapture";
import { FEATURES } from "../lib/features";
import { bufferToBase64 } from "../lib/resume/repo";

const APP_SOURCE = "job-copilot-app";
const EXTENSION_SOURCE = "job-copilot-extension";

/** The parts of `window` the bridge uses (a plain object in tests). */
export interface BridgeWindow {
  postMessage: (message: unknown, targetOrigin: string) => void;
  addEventListener: (type: "message", listener: (event: MessageEvent) => void) => void;
  removeEventListener: (type: "message", listener: (event: MessageEvent) => void) => void;
  location: { origin: string };
}

/**
 * Talks to the Chrome extension's content script (see extension/src/content/bridge.ts) over
 * window.postMessage: sends a copy of profile / answer bank / resume / key for the extension to
 * mirror into chrome.storage.local, and receives job postings captured with the extension's
 * "Score this job" button.
 *
 * OFF in the public build (FEATURES.extension): any other extension running on the page can read
 * window.postMessage traffic, and this sends the API key. With the flag off this does nothing at
 * all, not even add a listener, on top of app/layout.tsx not mounting the component. Returns the
 * cleanup.
 */
export function startExtensionBridge(win: BridgeWindow, enabled: boolean = FEATURES.extension): () => void {
  if (!enabled) return () => {};

  async function sendSync() {
    const [profile, answerBank, settings, baseResumes] = await Promise.all([getProfile(), getAnswerBank(), getSettings(), getBaseResumes()]);
    const latestResume = [...baseResumes].sort((a, b) => b.addedAt - a.addedAt)[0];
    win.postMessage(
      {
        source: APP_SOURCE,
        type: "SYNC_DATA",
        payload: {
          profile,
          answerBank: answerBank.map((a) => ({ question: a.question, answer: a.answer, tags: a.tags })),
          resume: latestResume ? { fileName: latestResume.fileName, base64: bufferToBase64(latestResume.bytes) } : null,
          anthropicKey: settings.anthropicKey,
          updatedAt: Date.now(),
        },
      },
      win.location.origin,
    );
  }

  function onMessage(event: MessageEvent) {
    if (event.source !== (win as unknown)) return;
    const data = event.data as { source?: string; type?: string; payload?: unknown } | null;
    if (!data || data.source !== EXTENSION_SOURCE) return;
    if (data.type === "REQUEST_SYNC") void sendSync();
    if (data.type === "CAPTURED_JOB") {
      const payload = data.payload as { text: string; url: string };
      storeCapturedJob({ text: payload.text, url: payload.url });
    }
  }

  win.addEventListener("message", onMessage);
  // Push once on load too, so an already-running extension content script has current data
  // even if it doesn't ask.
  void sendSync();
  return () => win.removeEventListener("message", onMessage);
}

export default function ExtensionBridge() {
  useEffect(() => startExtensionBridge(window), []);
  return null;
}
