// The extension's half of the app connection, free of chrome.* globals so it can be unit tested.
// background.ts wires it to the real chrome APIs.
//
// Safety model:
// - Only origins in APP_ORIGINS can reach the extension at all (manifest externally_connectable),
//   and every message is checked against that list again here.
// - A one-time pairing: the app asks, the extension opens its own window showing the origin and a
//   6-digit code, and only her click there issues a random token. The app's connection must present
//   that token for the origin it comes from, or it is rejected.
// - Nothing secret flows to the extension: no API key is ever requested or accepted.

import { isAppOrigin, PORT_NAME, PROTOCOL_VERSION, type AppToExt, type ExternalMessage, type PairStartReply, type PairStatusReply, type PingReply, type RequestMethod, type Requests } from "../protocol";

export interface PortLike {
  name: string;
  sender?: { origin?: string; url?: string; tab?: { id?: number } };
  postMessage(message: unknown): void;
  disconnect(): void;
  onMessage: { addListener(fn: (message: unknown) => void): void };
  onDisconnect: { addListener(fn: () => void): void };
}

export interface KV {
  get<T>(key: string): Promise<T | undefined>;
  set(key: string, value: unknown): Promise<void>;
  remove(key: string): Promise<void>;
}

export interface BridgeDeps {
  kv: KV;
  now(): number;
  randomToken(): string;
  randomCode(): string;
  version: string;
  /** Opens the extension's own confirmation window for a pairing request. */
  openPairWindow(origin: string, code: string): Promise<void>;
  /** Opens the app in a new tab; returns the tab id. */
  openApp(origin: string, opts: { active: boolean; path: string }): Promise<number | undefined>;
  closeTab(tabId: number): Promise<void>;
  focusTab(tabId: number): Promise<void>;
  /** A push from the authenticated app (sync data is already stored by the bridge). */
  onPush(method: string, params: unknown): void;
}

export interface Pairing {
  token: string;
  pairedAt: number;
}

export interface PendingPair {
  origin: string;
  code: string;
  status: "pending" | "approved" | "denied";
  token?: string;
  createdAt: number;
}

export interface OutboxItem {
  id: string;
  method: RequestMethod;
  params: unknown;
  createdAt: number;
}

export const KEYS = {
  pairings: "pairings",
  pendingPair: "pendingPair",
  outbox: "outbox",
  syncedData: "syncedData",
  appOrigin: "appOrigin",
} as const;

/** A pairing request she hasn't answered expires after this. */
export const PAIR_TTL_MS = 5 * 60 * 1000;
/** How long to wait for an app tab the extension opened to connect. */
export const APP_CONNECT_TIMEOUT_MS = 25_000;
const REQUEST_TIMEOUT_MS = 20_000;
/** Queued saves older than this are dropped rather than replayed. */
const OUTBOX_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;
const OUTBOX_MAX = 100;

interface Conn {
  port: PortLike;
  origin: string;
  tabId?: number;
}

export interface RequestOptions {
  timeoutMs?: number;
  /** When no app tab is connected: open one ("background" or "foreground") and wait for it. */
  openApp?: "background" | "foreground";
  /** When no app tab is connected: keep it in the outbox for the next connection instead. */
  queue?: boolean;
}

export class NotConnectedError extends Error {
  constructor(message = "Job Copilot isn't open or isn't connected.") {
    super(message);
    this.name = "NotConnectedError";
  }
}

export class Bridge {
  private conns: Conn[] = [];
  private pending = new Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  private connectWaiters: ((c: Conn) => void)[] = [];
  private seq = 0;

  constructor(private deps: BridgeDeps) {}

  // ---------------- Pairing (one-shot external messages) ----------------

  /** Handles chrome.runtime.onMessageExternal. Returns undefined for anything not from the app. */
  async handleExternal(message: unknown, senderOrigin: string | undefined): Promise<PingReply | PairStartReply | PairStatusReply | { ok: boolean } | undefined> {
    if (!isAppOrigin(senderOrigin)) return undefined;
    const msg = message as ExternalMessage | null;
    if (!msg || typeof msg !== "object") return undefined;
    switch (msg.type) {
      case "PING": {
        const paired = typeof msg.token === "string" && (await this.isValidToken(senderOrigin, msg.token));
        return { ok: true, version: this.deps.version, protocol: PROTOCOL_VERSION, paired };
      }
      case "PAIR_START":
        return this.startPairing(senderOrigin);
      case "PAIR_STATUS":
        return this.pairStatus(senderOrigin);
      case "UNPAIR": {
        if (typeof msg.token !== "string" || !(await this.isValidToken(senderOrigin, msg.token))) return { ok: false };
        await this.unpair(senderOrigin);
        return { ok: true };
      }
      default:
        return undefined;
    }
  }

  private async startPairing(origin: string): Promise<PairStartReply> {
    const code = this.deps.randomCode();
    const pending: PendingPair = { origin, code, status: "pending", createdAt: this.deps.now() };
    await this.deps.kv.set(KEYS.pendingPair, pending);
    await this.deps.openPairWindow(origin, code);
    return { ok: true, code };
  }

  private async pairStatus(origin: string): Promise<PairStatusReply> {
    const p = await this.deps.kv.get<PendingPair>(KEYS.pendingPair);
    if (!p || p.origin !== origin) return { status: "none" };
    if (p.status === "pending" && this.deps.now() - p.createdAt > PAIR_TTL_MS) {
      await this.deps.kv.remove(KEYS.pendingPair);
      return { status: "expired" };
    }
    if (p.status === "approved" && p.token) {
      // Handed over once, then forgotten here (the pairing itself is kept under KEYS.pairings).
      await this.deps.kv.remove(KEYS.pendingPair);
      return { status: "approved", token: p.token };
    }
    if (p.status === "denied") {
      await this.deps.kv.remove(KEYS.pendingPair);
      return { status: "denied" };
    }
    return { status: "pending" };
  }

  /** The current pairing request, for the confirmation window. */
  async pendingPairing(): Promise<PendingPair | undefined> {
    const p = await this.deps.kv.get<PendingPair>(KEYS.pendingPair);
    if (!p || p.status !== "pending" || this.deps.now() - p.createdAt > PAIR_TTL_MS) return undefined;
    return p;
  }

  /** Her answer in the confirmation window. Only callable from the extension's own page. */
  async decidePairing(code: string, allow: boolean): Promise<boolean> {
    const p = await this.pendingPairing();
    if (!p || p.code !== code) return false;
    if (!allow) {
      await this.deps.kv.set(KEYS.pendingPair, { ...p, status: "denied" });
      return true;
    }
    const token = this.deps.randomToken();
    const pairings = (await this.deps.kv.get<Record<string, Pairing>>(KEYS.pairings)) ?? {};
    pairings[p.origin] = { token, pairedAt: this.deps.now() };
    await this.deps.kv.set(KEYS.pairings, pairings);
    await this.deps.kv.set(KEYS.pendingPair, { ...p, status: "approved", token });
    if (!(await this.deps.kv.get<string>(KEYS.appOrigin))) await this.deps.kv.set(KEYS.appOrigin, p.origin);
    return true;
  }

  async unpair(origin: string): Promise<void> {
    const pairings = (await this.deps.kv.get<Record<string, Pairing>>(KEYS.pairings)) ?? {};
    delete pairings[origin];
    await this.deps.kv.set(KEYS.pairings, pairings);
    for (const c of this.conns.filter((c) => c.origin === origin)) c.port.disconnect();
    this.conns = this.conns.filter((c) => c.origin !== origin);
  }

  async pairedOrigins(): Promise<string[]> {
    return Object.keys((await this.deps.kv.get<Record<string, Pairing>>(KEYS.pairings)) ?? {});
  }

  private async isValidToken(origin: string, token: string): Promise<boolean> {
    const pairings = (await this.deps.kv.get<Record<string, Pairing>>(KEYS.pairings)) ?? {};
    const expected = pairings[origin]?.token;
    return !!expected && !!token && timingSafeEqual(expected, token);
  }

  // ---------------- The long-lived connection ----------------

  /** Handles chrome.runtime.onConnectExternal. */
  handleConnect(port: PortLike): void {
    const origin = port.sender?.origin ?? originOf(port.sender?.url);
    if (port.name !== PORT_NAME || !isAppOrigin(origin)) {
      port.disconnect();
      return;
    }
    let conn: Conn | null = null;
    port.onMessage.addListener((raw) => {
      const msg = raw as AppToExt | null;
      if (!msg || typeof msg !== "object") return;
      if (!conn) {
        if (msg.kind !== "hello") return;
        void this.isValidToken(origin, msg.token).then((ok) => {
          if (!ok) {
            port.postMessage({ kind: "rejected", reason: "not-paired" });
            port.disconnect();
            return;
          }
          conn = { port, origin, tabId: port.sender?.tab?.id };
          this.conns.push(conn);
          port.postMessage({ kind: "welcome" });
          void this.flushOutbox(conn);
          const waiters = this.connectWaiters.splice(0);
          waiters.forEach((w) => w(conn!));
        });
        return;
      }
      if (msg.kind === "res") {
        const p = this.pending.get(msg.id);
        if (!p) return;
        this.pending.delete(msg.id);
        clearTimeout(p.timer);
        if (msg.error) p.reject(new Error(msg.error));
        else p.resolve(msg.result);
        return;
      }
      if (msg.kind === "push") {
        if (msg.method === "sync") void this.deps.kv.set(KEYS.syncedData, msg.params);
        this.deps.onPush(msg.method, msg.params);
      }
    });
    port.onDisconnect.addListener(() => {
      this.conns = this.conns.filter((c) => c.port !== port);
    });
  }

  isConnected(): boolean {
    return this.conns.length > 0;
  }

  /** The connected app tab, if any (the most recent one). */
  activeTabId(): number | undefined {
    return this.conns[this.conns.length - 1]?.tabId;
  }

  private nextId(): string {
    this.seq += 1;
    return `${this.deps.now().toString(36)}-${this.seq}`;
  }

  private send<M extends RequestMethod>(conn: Conn, method: M, params: Requests[M]["params"], timeoutMs: number): Promise<Requests[M]["result"]> {
    const id = this.nextId();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error("Job Copilot didn't answer in time."));
      }, timeoutMs);
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject, timer });
      try {
        conn.port.postMessage({ kind: "req", id, method, params });
      } catch (e) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(e instanceof Error ? e : new Error(String(e)));
      }
    });
  }

  private waitForConnection(timeoutMs: number): Promise<Conn> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.connectWaiters = this.connectWaiters.filter((w) => w !== done);
        reject(new NotConnectedError("Job Copilot opened but didn't connect. Check Settings > Chrome extension there."));
      }, timeoutMs);
      const done = (c: Conn) => {
        clearTimeout(timer);
        resolve(c);
      };
      this.connectWaiters.push(done);
    });
  }

  /** Where to open the app: her chosen origin if paired, else the first paired one. */
  async appOrigin(): Promise<string | null> {
    const paired = await this.pairedOrigins();
    if (paired.length === 0) return null;
    const chosen = await this.deps.kv.get<string>(KEYS.appOrigin);
    return chosen && paired.includes(chosen) ? chosen : paired[0];
  }

  /**
   * Asks the app something. When no app tab is connected: queue it (`queue`), open the app and
   * wait (`openApp`), or fail with NotConnectedError. Returns `{ queued: true }` when queued.
   */
  async request<M extends RequestMethod>(method: M, params: Requests[M]["params"], opts: RequestOptions = {}): Promise<Requests[M]["result"] | { queued: true }> {
    const timeoutMs = opts.timeoutMs ?? REQUEST_TIMEOUT_MS;
    const live = this.conns[this.conns.length - 1];
    if (live) return this.send(live, method, params, timeoutMs);
    if (opts.queue) {
      await this.enqueue(method, params);
      return { queued: true };
    }
    if (!opts.openApp) throw new NotConnectedError();
    const origin = await this.appOrigin();
    if (!origin) throw new NotConnectedError("Not connected yet. In Job Copilot, open Settings > Chrome extension and click Connect.");
    const waiting = this.waitForConnection(APP_CONNECT_TIMEOUT_MS);
    const tabId = await this.deps.openApp(origin, { active: opts.openApp === "foreground", path: "/?from=extension" });
    const conn = await waiting;
    try {
      return await this.send(conn, method, params, timeoutMs);
    } finally {
      // A tab opened in the background only to answer this goes away again.
      if (opts.openApp === "background" && tabId !== undefined && method !== "draftRequest") void this.deps.closeTab(tabId).catch(() => {});
    }
  }

  async focusApp(): Promise<void> {
    const tabId = this.activeTabId();
    if (tabId !== undefined) await this.deps.focusTab(tabId);
  }

  private async enqueue(method: RequestMethod, params: unknown): Promise<void> {
    const now = this.deps.now();
    const outbox = ((await this.deps.kv.get<OutboxItem[]>(KEYS.outbox)) ?? []).filter((i) => now - i.createdAt < OUTBOX_MAX_AGE_MS);
    outbox.push({ id: this.nextId(), method, params, createdAt: now });
    await this.deps.kv.set(KEYS.outbox, outbox.slice(-OUTBOX_MAX));
  }

  private async flushOutbox(conn: Conn): Promise<void> {
    const now = this.deps.now();
    const outbox = ((await this.deps.kv.get<OutboxItem[]>(KEYS.outbox)) ?? []).filter((i) => now - i.createdAt < OUTBOX_MAX_AGE_MS);
    if (outbox.length === 0) return;
    await this.deps.kv.set(KEYS.outbox, []);
    for (const item of outbox) {
      // Best effort: a failed replay goes back in the outbox for next time.
      this.send(conn, item.method, item.params as never, REQUEST_TIMEOUT_MS).catch(() => this.enqueue(item.method, item.params));
    }
  }
}

function originOf(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    return new URL(url).origin;
  } catch {
    return undefined;
  }
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** 32 random bytes as hex. */
export function randomHex(bytes = 32): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return [...buf].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** A 6-digit code she compares between the app and the extension window. */
export function randomSixDigits(): string {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return String(buf[0] % 1_000_000).padStart(6, "0");
}
