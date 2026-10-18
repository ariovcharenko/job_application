import { describe, expect, it, vi } from "vitest";
import { Bridge, KEYS, NotConnectedError, PAIR_TTL_MS, type BridgeDeps, type KV, type PortLike } from "./bridgeCore";
import { PORT_NAME, PROTOCOL_VERSION } from "../protocol";

const APP = "https://job-copilot-arina-ovcharenkos-projects.vercel.app";
const LOCAL = "http://localhost:3000";

function memoryKV(): KV & { data: Map<string, unknown> } {
  const data = new Map<string, unknown>();
  return {
    data,
    async get<T>(k: string) {
      return structuredClone(data.get(k)) as T | undefined;
    },
    async set(k, v) {
      data.set(k, structuredClone(v));
    },
    async remove(k) {
      data.delete(k);
    },
  };
}

function setup(over: Partial<BridgeDeps> = {}) {
  const kv = memoryKV();
  let now = 1_000_000;
  let tokenN = 0;
  const deps: BridgeDeps = {
    kv,
    now: () => now,
    randomToken: () => `token-${++tokenN}`,
    randomCode: () => "123456",
    version: "0.2.0",
    openPairWindow: vi.fn(async () => {}),
    openApp: vi.fn(async () => 42),
    closeTab: vi.fn(async () => {}),
    focusTab: vi.fn(async () => {}),
    onPush: vi.fn(),
    ...over,
  };
  const bridge = new Bridge(deps);
  return { bridge, deps, kv, advance: (ms: number) => (now += ms) };
}

function fakePort(origin: string, name = PORT_NAME) {
  const msgListeners: ((m: unknown) => void)[] = [];
  const discListeners: (() => void)[] = [];
  const sent: unknown[] = [];
  const port: PortLike & { sent: unknown[]; fromApp(m: unknown): void; disconnected: boolean } = {
    name,
    sender: { origin, tab: { id: 7 } },
    sent,
    disconnected: false,
    postMessage: (m) => sent.push(m),
    disconnect() {
      port.disconnected = true;
      discListeners.forEach((l) => l());
    },
    onMessage: { addListener: (fn) => msgListeners.push(fn) },
    onDisconnect: { addListener: (fn) => discListeners.push(fn) },
    fromApp: (m) => msgListeners.forEach((l) => l(m)),
  };
  return port;
}

const flush = () => new Promise((r) => setTimeout(r, 0));

async function pair(bridge: Bridge, origin = APP): Promise<string> {
  await bridge.handleExternal({ type: "PAIR_START" }, origin);
  await bridge.decidePairing("123456", true);
  const status = (await bridge.handleExternal({ type: "PAIR_STATUS" }, origin)) as { status: string; token: string };
  return status.token;
}

async function connect(bridge: Bridge, token: string, origin = APP) {
  const port = fakePort(origin);
  bridge.handleConnect(port);
  port.fromApp({ kind: "hello", token, protocol: PROTOCOL_VERSION });
  await flush();
  await flush();
  return port;
}

describe("who may talk to the extension", () => {
  it("ignores every message from an origin that isn't the app", async () => {
    const { bridge, deps } = setup();
    expect(await bridge.handleExternal({ type: "PING" }, "https://evil.example")).toBeUndefined();
    expect(await bridge.handleExternal({ type: "PAIR_START" }, "https://evil.example")).toBeUndefined();
    expect(await bridge.handleExternal({ type: "PAIR_START" }, undefined)).toBeUndefined();
    expect(deps.openPairWindow).not.toHaveBeenCalled();
  });

  it("disconnects a port from any other origin or with another name", () => {
    const { bridge } = setup();
    const evil = fakePort("https://evil.example");
    bridge.handleConnect(evil);
    expect(evil.disconnected).toBe(true);
    const wrongName = fakePort(APP, "something-else");
    bridge.handleConnect(wrongName);
    expect(wrongName.disconnected).toBe(true);
  });

  it("answers PING with paired: false until paired", async () => {
    const { bridge } = setup();
    expect(await bridge.handleExternal({ type: "PING" }, APP)).toEqual({ ok: true, version: "0.2.0", protocol: PROTOCOL_VERSION, paired: false });
  });
});

describe("pairing", () => {
  it("opens the extension's own window and issues a token only after she clicks Connect", async () => {
    const { bridge, deps } = setup();
    expect(await bridge.handleExternal({ type: "PAIR_START" }, APP)).toEqual({ ok: true, code: "123456" });
    expect(deps.openPairWindow).toHaveBeenCalledWith(APP, "123456");
    expect(await bridge.handleExternal({ type: "PAIR_STATUS" }, APP)).toEqual({ status: "pending" });
    expect(await bridge.decidePairing("123456", true)).toBe(true);
    const status = await bridge.handleExternal({ type: "PAIR_STATUS" }, APP);
    expect(status).toEqual({ status: "approved", token: "token-1" });
    // The token is handed over once.
    expect(await bridge.handleExternal({ type: "PAIR_STATUS" }, APP)).toEqual({ status: "none" });
    expect(await bridge.handleExternal({ type: "PING", token: "token-1" }, APP)).toMatchObject({ paired: true });
  });

  it("a wrong code or a denial issues nothing", async () => {
    const { bridge } = setup();
    await bridge.handleExternal({ type: "PAIR_START" }, APP);
    expect(await bridge.decidePairing("000000", true)).toBe(false);
    await bridge.decidePairing("123456", false);
    expect(await bridge.handleExternal({ type: "PAIR_STATUS" }, APP)).toEqual({ status: "denied" });
    expect(await bridge.pairedOrigins()).toEqual([]);
  });

  it("a request expires if she doesn't answer", async () => {
    const { bridge, advance } = setup();
    await bridge.handleExternal({ type: "PAIR_START" }, APP);
    advance(PAIR_TTL_MS + 1);
    expect(await bridge.decidePairing("123456", true)).toBe(false);
    expect(await bridge.handleExternal({ type: "PAIR_STATUS" }, APP)).toEqual({ status: "expired" });
  });

  it("another app origin can't collect a token meant for the first", async () => {
    const { bridge } = setup();
    await bridge.handleExternal({ type: "PAIR_START" }, APP);
    await bridge.decidePairing("123456", true);
    expect(await bridge.handleExternal({ type: "PAIR_STATUS" }, LOCAL)).toEqual({ status: "none" });
  });

  it("a token for one origin doesn't work for the other", async () => {
    const { bridge } = setup();
    const token = await pair(bridge, APP);
    expect(await bridge.handleExternal({ type: "PING", token }, LOCAL)).toMatchObject({ paired: false });
  });

  it("UNPAIR needs the token, then forgets the pairing", async () => {
    const { bridge } = setup();
    const token = await pair(bridge);
    expect(await bridge.handleExternal({ type: "UNPAIR", token: "nope" }, APP)).toEqual({ ok: false });
    expect(await bridge.handleExternal({ type: "UNPAIR", token }, APP)).toEqual({ ok: true });
    expect(await bridge.pairedOrigins()).toEqual([]);
  });
});

describe("the connection", () => {
  it("rejects a hello without the right token", async () => {
    const { bridge } = setup();
    await pair(bridge);
    const port = await connect(bridge, "wrong");
    expect(port.sent).toContainEqual({ kind: "rejected", reason: "not-paired" });
    expect(port.disconnected).toBe(true);
    expect(bridge.isConnected()).toBe(false);
  });

  it("ignores requests and pushes before the hello is accepted", async () => {
    const { bridge, kv } = setup();
    const port = fakePort(APP);
    bridge.handleConnect(port);
    port.fromApp({ kind: "push", method: "sync", params: { updatedAt: 1 } });
    await flush();
    expect(kv.data.has(KEYS.syncedData)).toBe(false);
  });

  it("accepts the paired app, stores sync pushes and answers requests by id", async () => {
    const { bridge, kv } = setup();
    const token = await pair(bridge);
    const port = await connect(bridge, token);
    expect(port.sent).toContainEqual({ kind: "welcome" });
    port.fromApp({ kind: "push", method: "sync", params: { updatedAt: 5 } });
    await flush();
    expect(kv.data.get(KEYS.syncedData)).toEqual({ updatedAt: 5 });

    const pending = bridge.request("getResume", { jobId: 3 });
    const req = port.sent.find((m) => (m as { kind: string }).kind === "req") as { id: string; method: string; params: unknown };
    expect(req).toMatchObject({ method: "getResume", params: { jobId: 3 } });
    port.fromApp({ kind: "res", id: req.id, result: { fileName: "a.docx" } });
    await expect(pending).resolves.toEqual({ fileName: "a.docx" });
  });

  it("never sends anything that looks like an API key", async () => {
    const { bridge } = setup();
    const token = await pair(bridge);
    const port = await connect(bridge, token);
    await bridge.request("saveAnswer", { question: "q", answer: "a" }, { timeoutMs: 5 }).catch(() => {});
    expect(JSON.stringify(port.sent)).not.toMatch(/key/i);
  });

  it("queues saves while the app is closed and delivers them on the next connection", async () => {
    const { bridge } = setup();
    const token = await pair(bridge);
    await expect(bridge.request("saveAnswer", { question: "Referral source", answer: "A friend" }, { queue: true })).resolves.toEqual({ queued: true });
    const port = await connect(bridge, token);
    await flush();
    expect(port.sent).toContainEqual(expect.objectContaining({ kind: "req", method: "saveAnswer", params: { question: "Referral source", answer: "A friend" } }));
  });

  it("fails clearly when not connected and not allowed to open the app", async () => {
    const { bridge } = setup();
    await expect(bridge.request("getResume", { jobId: 1 })).rejects.toBeInstanceOf(NotConnectedError);
  });

  it("refuses to open the app when it was never paired", async () => {
    const { bridge, deps } = setup();
    await expect(bridge.request("getResume", { jobId: 1 }, { openApp: "background" })).rejects.toThrow(/Connect/);
    expect(deps.openApp).not.toHaveBeenCalled();
  });

  it("opens the app in the background, waits for it to connect, asks, then closes that tab", async () => {
    const holder: { bridge?: Bridge; token?: string; port?: ReturnType<typeof fakePort> } = {};
    const { bridge, deps } = setup({
      openApp: vi.fn(async () => {
        setTimeout(async () => {
          holder.port = await connect(holder.bridge!, holder.token!);
        }, 0);
        return 99;
      }),
    });
    holder.bridge = bridge;
    holder.token = await pair(bridge);
    const pending = bridge.request("getResume", { jobId: 2 }, { openApp: "background" });
    await vi.waitFor(() => expect(holder.port?.sent.some((m) => (m as { kind: string }).kind === "req")).toBe(true));
    const req = holder.port!.sent.find((m) => (m as { kind: string }).kind === "req") as { id: string };
    holder.port!.fromApp({ kind: "res", id: req.id, result: null });
    await expect(pending).resolves.toBeNull();
    expect(deps.openApp).toHaveBeenCalledWith(APP, { active: false, path: "/?from=extension" });
    expect(deps.closeTab).toHaveBeenCalledWith(99);
  });

  it("forwards draft results to onPush", async () => {
    const { bridge, deps } = setup();
    const token = await pair(bridge);
    const port = await connect(bridge, token);
    port.fromApp({ kind: "push", method: "draftResult", params: { requestId: "r1", answer: "Hi" } });
    expect(deps.onPush).toHaveBeenCalledWith("draftResult", { requestId: "r1", answer: "Hi" });
  });

  it("unpairing drops the live connection", async () => {
    const { bridge } = setup();
    const token = await pair(bridge);
    const port = await connect(bridge, token);
    await bridge.unpair(APP);
    expect(port.disconnected).toBe(true);
    expect(bridge.isConnected()).toBe(false);
  });
});
