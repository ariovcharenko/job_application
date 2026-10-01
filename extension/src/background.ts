// Service worker: keeps the bridge content script registered on whichever URL the app runs at
// (configurable in the popup, since this is meant to be deployed anywhere — not hardcoded to
// localhost). Everything else (capture, fill) is a static content script declared in manifest.json
// since it needs to run broadly, not just on the app's own origin.
import { getAppOrigin } from "./lib/storage";

const BRIDGE_SCRIPT_ID = "job-copilot-bridge";

async function registerBridge(): Promise<void> {
  const origin = await getAppOrigin();
  const existing = await chrome.scripting.getRegisteredContentScripts({ ids: [BRIDGE_SCRIPT_ID] });
  if (existing.length) await chrome.scripting.unregisterContentScripts({ ids: [BRIDGE_SCRIPT_ID] });
  await chrome.scripting.registerContentScripts([
    {
      id: BRIDGE_SCRIPT_ID,
      matches: [`${origin}/*`],
      js: ["content/bridge.js"],
      runAt: "document_idle",
    },
  ]);
}

chrome.runtime.onInstalled.addListener(() => {
  registerBridge().catch((err) => console.error("[Job Copilot] failed to register bridge", err));
});
chrome.runtime.onStartup?.addListener(() => {
  registerBridge().catch((err) => console.error("[Job Copilot] failed to register bridge", err));
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && "appOrigin" in changes) {
    registerBridge().catch((err) => console.error("[Job Copilot] failed to re-register bridge", err));
  }
});
