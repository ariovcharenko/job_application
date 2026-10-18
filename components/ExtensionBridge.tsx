"use client";

import dynamic from "next/dynamic";
import { useEffect } from "react";
// Relative imports (not "@/"), so the bridge's logic can be unit-tested under Vitest.
import { liveQuery } from "dexie";
import { pageRuntime } from "../lib/extension/client";
import { appHandlerDeps } from "../lib/extension/appDeps";
import { setLink, setLinkStatus } from "../lib/extension/hub";
import { ExtensionLink } from "../lib/extension/link";
import { buildSyncedData } from "../lib/extension/payload";
import { getExtensionId, getPairingToken, SESSION_EVENT } from "../lib/extension/session";
import { FEATURES } from "../lib/features";

// The draft dialog pulls in the AI client, so it loads only when the extension asks for a draft.
const DraftRequestDialog = dynamic(() => import("./extension/DraftRequestDialog"), { ssr: false });

const RETRY_MS = [2000, 5000, 15000, 30000];

/**
 * Keeps the app connected to the Chrome extension, once she has paired them in Settings. Point to
 * point (chrome.runtime, only from this site's origin); nothing is posted to the page, and no API
 * key is ever sent. Without a pairing token, or outside Chrome, this does nothing at all.
 * Returns the cleanup.
 */
export function startExtensionBridge(enabled: boolean = FEATURES.extension): () => void {
  if (!enabled) return () => {};
  let link: ExtensionLink | null = null;
  let retry = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let sub: { unsubscribe(): void } | undefined;
  let stopped = false;

  const stopLink = () => {
    clearTimeout(timer);
    sub?.unsubscribe();
    sub = undefined;
    link?.disconnect();
    link = null;
    setLink(null);
  };

  const start = () => {
    stopLink();
    const token = getPairingToken();
    const runtime = pageRuntime();
    if (!token || !runtime || stopped) return;
    const l = new ExtensionLink({
      runtime,
      extensionId: getExtensionId(),
      token,
      deps: appHandlerDeps(),
      onStatus(s) {
        setLinkStatus(s);
        if (s === "connected") {
          retry = 0;
          // Keep the extension's copy current while the app is open.
          let first = true;
          let debounce: ReturnType<typeof setTimeout> | undefined;
          sub = liveQuery(() => buildSyncedData()).subscribe({
            next: (data) => {
              if (first) {
                first = false;
                return;
              }
              clearTimeout(debounce);
              debounce = setTimeout(() => link?.pushSync(data), 800);
            },
            error: () => {},
          });
        }
        if (s === "idle" && link === l && !stopped) {
          sub?.unsubscribe();
          sub = undefined;
          const delay = RETRY_MS[Math.min(retry++, RETRY_MS.length - 1)];
          timer = setTimeout(() => {
            if (link === l && document.visibilityState === "visible") l.connect();
            else if (link === l) timer = setTimeout(() => l.connect(), delay);
          }, delay);
        }
      },
    });
    link = l;
    setLink(l);
    l.connect();
  };

  const onSession = () => {
    retry = 0;
    start();
  };
  window.addEventListener(SESSION_EVENT, onSession);
  start();
  return () => {
    stopped = true;
    window.removeEventListener(SESSION_EVENT, onSession);
    stopLink();
  };
}

export default function ExtensionBridge() {
  useEffect(() => startExtensionBridge(), []);
  return <DraftRequestDialog />;
}
