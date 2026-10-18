import { openPort, type PortLike, type RuntimeLike } from "./client";
import { handleRequest, type HandlerDeps } from "./handlers";
import { PROTOCOL_VERSION, type DraftResult, type SyncedData } from "./protocol";

// The app's long-lived connection to the paired extension. It does nothing until a pairing token
// exists, answers the extension's requests through handleRequest, and pushes fresh data when the
// connection opens. If the extension's service worker sleeps the port closes; the owner calls
// connect() again (the component retries with a delay while the tab is visible).

export type LinkStatus = "idle" | "connecting" | "connected" | "rejected";

export interface LinkOptions {
  runtime: RuntimeLike | null;
  extensionId: string;
  token: string;
  deps: HandlerDeps;
  onStatus(status: LinkStatus): void;
}

export class ExtensionLink {
  private port: PortLike | null = null;
  private status: LinkStatus = "idle";

  constructor(private opts: LinkOptions) {}

  private set(status: LinkStatus) {
    this.status = status;
    this.opts.onStatus(status);
  }

  getStatus(): LinkStatus {
    return this.status;
  }

  /** Opens the connection. No-op without a runtime or token (never paired, or not Chrome). */
  connect(): boolean {
    const { runtime, extensionId, token } = this.opts;
    if (!runtime || !token || this.port) return false;
    const port = openPort(runtime, extensionId);
    if (!port) return false;
    this.port = port;
    this.set("connecting");
    port.onMessage.addListener((msg) => void this.onMessage(port, msg));
    port.onDisconnect.addListener(() => {
      if (this.port === port) this.port = null;
      if (this.status !== "rejected") this.set("idle");
    });
    port.postMessage({ kind: "hello", token, protocol: PROTOCOL_VERSION });
    return true;
  }

  private async onMessage(port: PortLike, msg: unknown) {
    const m = msg as { kind?: string; id?: string; method?: never; params?: unknown; reason?: string } | null;
    if (!m || typeof m !== "object") return;
    if (m.kind === "welcome") {
      this.set("connected");
      try {
        port.postMessage({ kind: "push", method: "sync", params: await this.opts.deps.buildData() });
      } catch {
        // Data is sent again when the extension asks for it.
      }
      return;
    }
    if (m.kind === "rejected") {
      this.set("rejected");
      return;
    }
    if (m.kind === "req" && typeof m.id === "string") {
      try {
        const result = await handleRequest(m.method as never, m.params, this.opts.deps);
        port.postMessage({ kind: "res", id: m.id, result });
      } catch (e) {
        port.postMessage({ kind: "res", id: m.id, error: e instanceof Error ? e.message : String(e) });
      }
    }
  }

  pushSync(data: SyncedData): void {
    if (this.status === "connected") this.port?.postMessage({ kind: "push", method: "sync", params: data });
  }

  sendDraftResult(result: DraftResult): boolean {
    if (this.status !== "connected" || !this.port) return false;
    this.port.postMessage({ kind: "push", method: "draftResult", params: result });
    return true;
  }

  sendDraftCancelled(requestId: string): void {
    if (this.status === "connected") this.port?.postMessage({ kind: "push", method: "draftCancelled", params: { requestId } });
  }

  disconnect(): void {
    const p = this.port;
    this.port = null;
    try {
      p?.disconnect();
    } catch {
      // already closed
    }
    this.set("idle");
  }
}
