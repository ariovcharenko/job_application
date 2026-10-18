"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { pageRuntime } from "@/lib/extension/client";
import { getLinkStatus, subscribeHub } from "@/lib/extension/hub";
import { detectExtension, disconnectExtension, pairWithExtension, type ExtensionState, type PairOutcome } from "@/lib/extension/pairing";
import { DEFAULT_EXTENSION_ID } from "@/lib/extension/protocol";
import { getExtensionId, getPairingToken, isExtensionId, SESSION_EVENT, setExtensionId } from "@/lib/extension/session";
import { Button, Card, inputClass, Notice } from "@/components/ui";

const OUTCOME_TEXT: Record<PairOutcome, string> = {
  approved: "",
  denied: "You chose Don't allow in the extension window. Nothing was connected.",
  expired: "That request timed out. Click Connect to try again.",
  unreachable: "The extension didn't answer. Check that it is loaded and enabled at chrome://extensions, then try again.",
  cancelled: "",
};

/** Pairs this browser with the Job Copilot Chrome extension. Settings only; no key is shared. */
export default function ExtensionCard() {
  const [state, setState] = useState<ExtensionState | null>(null);
  const [code, setCode] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [idText, setIdText] = useState("");
  const abort = useRef<AbortController | null>(null);
  const link = useSyncExternalStore(subscribeHub, getLinkStatus, () => "idle" as const);

  const refresh = useCallback(async () => {
    setState(await detectExtension(pageRuntime(), getExtensionId(), getPairingToken()));
  }, []);

  useEffect(() => {
    setIdText(getExtensionId());
    void refresh();
    window.addEventListener(SESSION_EVENT, refresh);
    return () => {
      window.removeEventListener(SESSION_EVENT, refresh);
      abort.current?.abort();
    };
  }, [refresh]);

  const connect = async () => {
    setMessage(null);
    abort.current?.abort();
    const ctl = new AbortController();
    abort.current = ctl;
    const outcome = await pairWithExtension(pageRuntime(), getExtensionId(), { onCode: setCode, signal: ctl.signal });
    setCode(null);
    setMessage(OUTCOME_TEXT[outcome] || null);
    await refresh();
  };

  const disconnect = async () => {
    abort.current?.abort();
    setCode(null);
    await disconnectExtension(pageRuntime(), getExtensionId(), getPairingToken());
    await refresh();
  };

  const saveId = () => {
    setExtensionId(idText);
    setIdText(getExtensionId());
    setMessage(null);
    void refresh();
  };

  const paired = state?.kind === "paired";
  return (
    <Card
      title="Chrome extension"
      hint="Fills application forms from your Profile, uploads the right tailored resume and marks a job applied after you submit it yourself. It never clicks Submit."
    >
      {state === null ? null : state.kind === "absent" ? (
        <Notice kind="info">
          The extension isn&apos;t reachable from this page. It works in Chrome, with the extension loaded. Steps are below. If you loaded it, check the ID under Advanced.
        </Notice>
      ) : paired ? (
        <Notice kind="ok">
          Connected{link === "connected" ? " and talking to this page" : ". It will reconnect when you open an application page"} (extension v{state.version}).
        </Notice>
      ) : state.kind === "stale" ? (
        <Notice kind="error">The extension no longer recognizes this browser. Click Connect to pair again.</Notice>
      ) : (
        <Notice kind="info">The extension is installed but not connected to this app yet.</Notice>
      )}

      {code && (
        <div className="mt-4 rounded-2xl bg-paper p-4">
          <p className="text-sm">A small window opened from the extension. Check that it shows this code, then click Allow there.</p>
          <p className="mt-2 text-[34px] font-semibold tracking-[0.2em] tabular-nums">{code}</p>
        </div>
      )}
      {message && (
        <div className="mt-4">
          <Notice kind="info">{message}</Notice>
        </div>
      )}

      <div className="mt-4 flex flex-wrap gap-3">
        {state && state.kind !== "absent" && !paired && !code && <Button onClick={connect}>Connect extension</Button>}
        {paired && (
          <Button variant="secondary" onClick={disconnect}>
            Disconnect
          </Button>
        )}
        <Button variant="secondary" onClick={() => void refresh()}>
          Check again
        </Button>
      </div>

      <div className="mt-6 grid gap-5 text-sm sm:grid-cols-2">
        <div>
          <h3 className="font-semibold">What the extension gets</h3>
          <ul className="mt-1.5 list-disc space-y-1 pl-5 text-muted">
            <li>Your Profile, saved answers and Your experience text.</li>
            <li>A list of your jobs (company, role, link) to recognize the page.</li>
            <li>A resume file, only when it fills an application.</li>
          </ul>
        </div>
        <div>
          <h3 className="font-semibold">What it never gets</h3>
          <ul className="mt-1.5 list-disc space-y-1 pl-5 text-muted">
            <li>Any API key. Drafting an answer happens here, and you approve it here.</li>
            <li>Permission to submit, create accounts or enter passwords.</li>
            <li>Access to LinkedIn, Indeed or Jobright.</li>
          </ul>
        </div>
      </div>

      <details className="mt-6 text-sm">
        <summary className="cursor-pointer font-medium">Install steps</summary>
        <ol className="mt-2 list-decimal space-y-1 pl-5 text-muted">
          <li>
            In a terminal: <code>cd extension &amp;&amp; npm install &amp;&amp; npm run build</code>
          </li>
          <li>Open chrome://extensions, turn on Developer mode, click Load unpacked and pick the extension/dist folder.</li>
          <li>Come back here and click Connect extension. Check the code in the small window and click Allow.</li>
        </ol>
      </details>
      <details className="mt-3 text-sm">
        <summary className="cursor-pointer font-medium">Advanced</summary>
        <p className="mt-2 text-muted">
          The extension ID is fixed by a key in its manifest, so it is the same on every computer. Only change this if you built the extension without that
          key.
        </p>
        <div className="mt-2 flex flex-wrap gap-3">
          <input className={`${inputClass} max-w-md font-mono text-sm`} value={idText} onChange={(e) => setIdText(e.target.value)} aria-label="Extension ID" spellCheck={false} />
          <Button variant="secondary" onClick={saveId} disabled={!isExtensionId(idText.trim())}>
            Save ID
          </Button>
          {idText.trim() !== DEFAULT_EXTENSION_ID && (
            <Button variant="secondary" onClick={() => setIdText(DEFAULT_EXTENSION_ID)}>
              Use the default
            </Button>
          )}
        </div>
      </details>
    </Card>
  );
}
