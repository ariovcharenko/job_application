import { pairingStatus, pingExtension, startPairing, unpairExtension, type RuntimeLike } from "./client";
import { notifySessionChanged, setPairingToken } from "./session";

// The Settings card's steps, as plain async functions so they can be tested without React.

export type ExtensionState =
  /** No Chrome extension answered: not installed, a different ID, or not Chrome. */
  | { kind: "absent" }
  | { kind: "unpaired"; version: string }
  | { kind: "paired"; version: string }
  /** We hold a token but the extension doesn't accept it (it was reset or reinstalled). */
  | { kind: "stale"; version: string };

export async function detectExtension(rt: RuntimeLike | null, id: string, token: string): Promise<ExtensionState> {
  const reply = await pingExtension(rt, id, token || undefined);
  if (!reply || reply.ok !== true) return { kind: "absent" };
  if (reply.paired) return { kind: "paired", version: reply.version };
  return token ? { kind: "stale", version: reply.version } : { kind: "unpaired", version: reply.version };
}

export type PairOutcome = "approved" | "denied" | "expired" | "unreachable" | "cancelled";

/**
 * Asks the extension to pair. It opens its own window with a code and her Allow/Cancel buttons;
 * `onCode` shows the same code here so she can check they match. Resolves when she answers.
 */
export async function pairWithExtension(
  rt: RuntimeLike | null,
  id: string,
  opts: { onCode(code: string): void; signal?: AbortSignal; pollMs?: number; timeoutMs?: number; sleep?: (ms: number) => Promise<void> },
): Promise<PairOutcome> {
  const sleep = opts.sleep ?? ((ms) => new Promise<void>((r) => setTimeout(r, ms)));
  const start = await startPairing(rt, id);
  if (!start || start.ok !== true) return "unreachable";
  opts.onCode(start.code);
  const deadline = Date.now() + (opts.timeoutMs ?? 5 * 60_000);
  while (Date.now() < deadline) {
    if (opts.signal?.aborted) return "cancelled";
    const st = await pairingStatus(rt, id);
    if (!st) return "unreachable";
    if (st.status === "approved") {
      setPairingToken(st.token);
      notifySessionChanged();
      return "approved";
    }
    if (st.status === "denied" || st.status === "expired") return st.status;
    if (st.status === "none") return "expired";
    await sleep(opts.pollMs ?? 1200);
  }
  return "expired";
}

/** Forgets the pairing here and tells the extension to forget it too (best effort). */
export async function disconnectExtension(rt: RuntimeLike | null, id: string, token: string): Promise<void> {
  if (token) await unpairExtension(rt, id, token);
  setPairingToken("");
  notifySessionChanged();
}
