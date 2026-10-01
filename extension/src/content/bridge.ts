// Runs only on the app's own origin (registered dynamically by background.ts — see
// registerBridge — based on the app URL set in the popup, default http://localhost:3000).
// Talks to the app page via window.postMessage and mirrors what it sends into
// chrome.storage.local, which every other content script reads from. No secrets leave the
// browser through this: it's page <-> extension storage on the same machine, nothing goes over
// the network here.
import { setSyncedData, takePendingCapture } from "../lib/storage";
import type { SyncedData } from "../types";

const APP_SOURCE = "job-copilot-app";
const EXTENSION_SOURCE = "job-copilot-extension";

interface AppMessage {
  source: typeof APP_SOURCE;
  type: "SYNC_DATA";
  payload: SyncedData;
}

function isAppMessage(data: unknown): data is AppMessage {
  return typeof data === "object" && data !== null && (data as { source?: unknown }).source === APP_SOURCE;
}

window.addEventListener("message", (event) => {
  if (event.source !== window) return;
  if (!isAppMessage(event.data)) return;
  if (event.data.type === "SYNC_DATA") {
    setSyncedData(event.data.payload).catch((err) => console.error("[Job Copilot] failed to store synced data", err));
  }
});

// Ask the app to send its current data as soon as this script loads (e.g. after a browser
// restart, or when the extension was just installed while the app tab was already open).
window.postMessage({ source: EXTENSION_SOURCE, type: "REQUEST_SYNC" }, window.location.origin);

// If "Score this job" was clicked on some other tab, hand the captured text to the app the
// moment it (re)loads.
takePendingCapture()
  .then((capture) => {
    if (capture) window.postMessage({ source: EXTENSION_SOURCE, type: "CAPTURED_JOB", payload: capture }, window.location.origin);
  })
  .catch((err) => console.error("[Job Copilot] failed to read pending capture", err));
