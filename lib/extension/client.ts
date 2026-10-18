import { PORT_NAME, PROTOCOL_VERSION, type AppToExt, type ExtToApp, type ExternalMessage, type PairStartReply, type PairStatusReply, type PingReply } from "./protocol";

// The browser side of the point-to-point connection. `chrome.runtime` exists on a web page only
// when this page's origin is in the extension's externally_connectable list and the extension is
// installed, so anywhere else (Safari, Firefox, no extension) every call here quietly does nothing.

export interface PortLike {
  postMessage(message: AppToExt): void;
  disconnect(): void;
  onMessage: { addListener(fn: (message: ExtToApp) => void): void };
  onDisconnect: { addListener(fn: () => void): void };
}

export interface RuntimeLike {
  sendMessage(id: string, message: unknown, callback: (response: unknown) => void): void;
  connect(id: string, info: { name: string }): PortLike;
  lastError?: { message?: string } | null;
}

export function pageRuntime(): RuntimeLike | null {
  const c = (globalThis as { chrome?: { runtime?: Partial<RuntimeLike> } }).chrome;
  return c?.runtime && typeof c.runtime.sendMessage === "function" && typeof c.runtime.connect === "function" ? (c.runtime as RuntimeLike) : null;
}

/** One-shot message to the extension. Resolves undefined when it isn't there or doesn't answer. */
export function sendToExtension<T>(rt: RuntimeLike | null, id: string, message: ExternalMessage): Promise<T | undefined> {
  return new Promise((resolve) => {
    if (!rt) return resolve(undefined);
    try {
      rt.sendMessage(id, message, (response) => {
        // Reading lastError marks it handled (otherwise Chrome logs "Unchecked runtime.lastError").
        void rt.lastError;
        resolve(response as T | undefined);
      });
    } catch {
      resolve(undefined);
    }
  });
}

export const pingExtension = (rt: RuntimeLike | null, id: string, token?: string) => sendToExtension<PingReply>(rt, id, { type: "PING", token });
export const startPairing = (rt: RuntimeLike | null, id: string) => sendToExtension<PairStartReply>(rt, id, { type: "PAIR_START" });
export const pairingStatus = (rt: RuntimeLike | null, id: string) => sendToExtension<PairStatusReply>(rt, id, { type: "PAIR_STATUS" });
export const unpairExtension = (rt: RuntimeLike | null, id: string, token: string) => sendToExtension<{ ok: boolean }>(rt, id, { type: "UNPAIR", token });

export function openPort(rt: RuntimeLike, id: string): PortLike | null {
  try {
    return rt.connect(id, { name: PORT_NAME });
  } catch {
    return null;
  }
}

export { PROTOCOL_VERSION };
