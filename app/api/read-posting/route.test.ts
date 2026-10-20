import https from "node:https";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const lookupMock = vi.hoisted(() => vi.fn());
vi.mock("node:dns/promises", () => ({ default: { lookup: lookupMock }, lookup: lookupMock }));

import { GET, POST } from "./route";

function req(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request("https://app.example.com/api/read-posting", {
    method: "POST",
    headers: { host: "app.example.com", origin: "https://app.example.com", "content-type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}
const json = async (r: Response) => (await r.json()) as { error?: { kind: string; message: string }; posting?: unknown; closed?: boolean };

let requestSpy: { mockRestore(): void } & { mock: { calls: unknown[] } };
let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  lookupMock.mockReset();
  requestSpy = vi.spyOn(https, "request") as unknown as typeof requestSpy;
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  requestSpy.mockRestore();
  vi.unstubAllGlobals();
});

describe("/api/read-posting", () => {
  it("GET is refused, responses are never cached", async () => {
    const r = await GET();
    expect(r.status).toBe(405);
    expect(r.headers.get("allow")).toBe("POST");
    const p = await POST(req({ url: "https://jobs.brightloop.example/x" }, { origin: "https://evil.example" }));
    expect(p.headers.get("cache-control")).toBe("no-store");
  });

  it("rejects other origins and a missing origin before doing anything", async () => {
    expect((await POST(req({ url: "https://jobs.brightloop.example/x" }, { origin: "https://evil.example" }))).status).toBe(403);
    const none = new Request("https://app.example.com/api/read-posting", { method: "POST", body: JSON.stringify({ url: "https://jobs.brightloop.example/x" }) });
    expect((await POST(none)).status).toBe(403);
    expect(lookupMock).not.toHaveBeenCalled();
  });

  it("validates the body", async () => {
    expect((await POST(req("nope"))).status).toBe(400);
    expect((await json(await POST(req({})))).error?.kind).toBe("bad_url");
    expect((await json(await POST(req({ url: 5 })))).error?.kind).toBe("bad_url");
    expect((await POST(req({ url: "x".repeat(5000) }))).status).toBe(413);
    expect(lookupMock).not.toHaveBeenCalled();
  });

  it("maps SSRF refusals to clean error kinds with no network", async () => {
    const cases: [string, string][] = [
      ["http://jobs.brightloop.example/x", "bad_url"],
      ["https://127.0.0.1/", "private_address"],
      ["https://www.linkedin.com/jobs/view/1", "blocked_host"],
    ];
    for (const [url, kind] of cases) {
      const r = await POST(req({ url }));
      expect((await json(r)).error?.kind, url).toBe(kind);
      expect(r.status).toBeGreaterThanOrEqual(400);
    }
    expect(lookupMock).not.toHaveBeenCalled();
    expect(requestSpy).not.toHaveBeenCalled();
  });

  it("a name that resolves to a private address is refused without connecting", async () => {
    lookupMock.mockResolvedValue([{ address: "192.168.1.10", family: 4 }]);
    const r = await POST(req({ url: "https://jobs.brightloop.example/x" }));
    expect((await json(r)).error?.kind).toBe("private_address");
    expect(requestSpy).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("never logs", async () => {
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => {}));
    lookupMock.mockResolvedValue([{ address: "10.0.0.1", family: 4 }]);
    await POST(req({ url: "https://jobs.brightloop.example/secret-path" }));
    await POST(req({ url: "http://x.example/" }));
    for (const s of spies) expect(s).not.toHaveBeenCalled();
    spies.forEach((s) => s.mockRestore());
  });
});
