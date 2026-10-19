import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST, JEV_URL } from "./route";

const KEY = "test-jev-key-123456";
const q = { a: { type: "noul", instructions: "x" } };

function req(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request("https://app.example.com/api/jev", {
    method: "POST",
    headers: { host: "app.example.com", origin: "https://app.example.com", "content-type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

const json = async (r: Response) => (await r.json()) as { error?: { kind: string; retryAfterMs?: number; message: string } };

describe("/api/jev", () => {
  it("refuses a request with no key and makes no outgoing fetch", async () => {
    for (const body of [{ state: "t", questions: q }, { key: "", state: "t", questions: q }, { key: "   ", state: "t", questions: q }]) {
      const r = await POST(req(body));
      expect(r.status).toBe(401);
      expect((await json(r)).error?.kind).toBe("no_key");
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects other origins and missing origin without fetching", async () => {
    expect((await POST(req({ key: KEY, state: "t", questions: q }, { origin: "https://evil.example" }))).status).toBe(403);
    const noOrigin = new Request("https://app.example.com/api/jev", { method: "POST", body: JSON.stringify({ key: KEY, state: "t", questions: q }) });
    expect((await POST(noOrigin)).status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("accepts the Referer when there is no Origin, and localhost", async () => {
    fetchMock.mockResolvedValue(new Response("{}", { status: 200 }));
    const noOrigin = new Request("http://localhost:3000/api/jev", { method: "POST", headers: { referer: "http://localhost:3000/settings", host: "localhost:3000" }, body: JSON.stringify({ key: KEY, state: "t", questions: q }) });
    expect((await POST(noOrigin)).status).toBe(200);
  });

  it("validates shape and sizes", async () => {
    const many = Object.fromEntries(Array.from({ length: 21 }, (_, i) => [`q${i}`, q.a]));
    expect((await POST(req("nope"))).status).toBe(400);
    expect((await POST(req({ key: KEY, state: 5, questions: q }))).status).toBe(400);
    expect((await POST(req({ key: KEY, state: "t", questions: {} }))).status).toBe(400);
    expect((await POST(req({ key: KEY, state: "t", questions: many }))).status).toBe(400);
    expect((await json(await POST(req({ key: KEY, state: "x".repeat(60_001), questions: q })))).error?.kind).toBe("too_long");
    expect((await json(await POST(req({ key: "short", state: "t", questions: q })))).error?.kind).toBe("auth");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("forwards only to the fixed URL with the sent key and returns Jev's JSON as-is", async () => {
    const answer = { model: "jev-1.13.0", answers: { a: { type: "noul", noul: 0.9 } }, usage: { input_tokens: 1, output_tokens: 1 } };
    fetchMock.mockResolvedValue(new Response(JSON.stringify(answer), { status: 200 }));
    const r = await POST(req({ key: ` ${KEY} `, state: "hello", questions: q, model: "other", url: "https://evil.example" }));
    expect(r.status).toBe(200);
    expect(r.headers.get("cache-control")).toBe("no-store");
    expect(await r.json()).toEqual(answer);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(JEV_URL);
    expect(init.headers.Authorization).toBe(`Bearer ${KEY}`);
    expect(JSON.parse(init.body)).toEqual({ model: "jev-latest", state: "hello", questions: q });
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("maps failures to clean kinds", async () => {
    const cases: [Response, number, string][] = [
      [new Response("secret detail", { status: 401 }), 401, "auth"],
      [new Response("", { status: 403 }), 403, "auth"],
      [new Response("", { status: 429, headers: { "retry-after": "2" } }), 429, "rate_limit"],
      [new Response("", { status: 529 }), 529, "overloaded"],
      [new Response('{"error":"max_tokens_exceeded"}', { status: 400 }), 400, "too_long"],
      [new Response("", { status: 413 }), 413, "too_long"],
      [new Response("", { status: 422 }), 422, "bad_request"],
      [new Response("", { status: 500 }), 502, "unknown"],
    ];
    for (const [res, status, kind] of cases) {
      fetchMock.mockResolvedValueOnce(res);
      const r = await POST(req({ key: KEY, state: "t", questions: q }));
      const j = await json(r);
      expect([r.status, j.error?.kind]).toEqual([status, kind]);
      expect(JSON.stringify(j)).not.toContain("secret detail");
      expect(JSON.stringify(j)).not.toContain(KEY);
    }
    fetchMock.mockResolvedValueOnce(new Response("", { status: 429, headers: { "retry-after": "2" } }));
    expect((await json(await POST(req({ key: KEY, state: "t", questions: q })))).error?.retryAfterMs).toBe(2000);
  });

  it("maps network failures and timeouts", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("fetch failed"));
    expect((await json(await POST(req({ key: KEY, state: "t", questions: q })))).error?.kind).toBe("network");
    fetchMock.mockRejectedValueOnce(Object.assign(new Error("t"), { name: "TimeoutError" }));
    const r = await POST(req({ key: KEY, state: "t", questions: q }));
    expect([r.status, (await json(r)).error?.kind]).toEqual([504, "timeout"]);
  });

  it("never logs", async () => {
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => {}));
    fetchMock.mockResolvedValue(new Response("", { status: 500 }));
    await POST(req({ key: KEY, state: "t", questions: q }));
    spies.forEach((s) => expect(s).not.toHaveBeenCalled());
    spies.forEach((s) => s.mockRestore());
  });
});

describe("Jev key ownership", () => {
  it("route and client contain no process.env, and the route no console calls", () => {
    for (const f of ["app/api/jev/route.ts", "lib/ai/jev.ts"]) {
      let src = "";
      try {
        src = readFileSync(f, "utf8");
      } catch {
        if (f === "lib/ai/jev.ts") continue; // added in phase 2
        throw new Error(`${f} missing`);
      }
      expect(src, f).not.toMatch(/process\.env/);
    }
    expect(readFileSync("app/api/jev/route.ts", "utf8")).not.toMatch(/console\./);
  });
});
