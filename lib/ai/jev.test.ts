import { beforeEach, describe, expect, it, vi } from "vitest";
import { callJev, choice, JevError, MIN_GAP_MS, noul, parseJevResult, resetJevThrottle, score, testJevConnection } from "./jev";

const ok = (answers: object) => new Response(JSON.stringify({ model: "jev-1", answers }), { status: 200 });
const err = (status: number, kind: string, retryAfterMs?: number) => new Response(JSON.stringify({ error: { kind, message: "m", retryAfterMs } }), { status });

let clock = 0;
const sleeps: number[] = [];
const sleep = async (ms: number) => {
  sleeps.push(ms);
  clock += ms;
};
const now = () => clock;

beforeEach(() => {
  clock = 10_000;
  sleeps.length = 0;
  resetJevThrottle();
});

describe("builders", () => {
  it("build typed questions", () => {
    expect(noul("a")).toEqual({ type: "noul", instructions: "a" });
    expect(choice("a", { x: "d" })).toEqual({ type: "choice", instructions: "a", criteria: { x: "d" } });
    expect(score("a", ["lo", "hi"])).toEqual({ type: "score", instructions: "a", criteria: ["lo", "hi"] });
  });
});

describe("callJev", () => {
  it("posts key, state and questions to the same-origin route and parses typed answers", async () => {
    const f = vi.fn().mockResolvedValue(
      ok({ a: { type: "noul", noul: 0.95 }, b: { type: "choice", choice: "remote", confidence: 0.8, probabilities: { remote: 0.9 } }, c: { type: "bogus" } }),
    );
    const r = await callJev(" k-123456789 ", "text", { a: noul("q") }, { fetch: f as unknown as typeof fetch, sleep, now });
    expect(f.mock.calls[0][0]).toBe("/api/jev");
    expect(JSON.parse(f.mock.calls[0][1].body)).toEqual({ key: "k-123456789", state: "text", questions: { a: noul("q") } });
    expect(r.answers.a).toEqual({ type: "noul", noul: 0.95 });
    expect(r.answers.b).toMatchObject({ type: "choice", choice: "remote", confidence: 0.8 });
    expect(r.answers.c).toBeUndefined();
  });

  it("refuses an empty key without any request", async () => {
    const f = vi.fn();
    await expect(callJev("  ", "t", {}, { fetch: f as unknown as typeof fetch })).rejects.toMatchObject({ kind: "no_key" });
    expect(f).not.toHaveBeenCalled();
  });

  it("maps server errors to JevError kinds", async () => {
    for (const [status, kind] of [[401, "auth"], [400, "too_long"], [502, "network"]] as const) {
      resetJevThrottle();
      const f = vi.fn().mockResolvedValue(err(status, kind));
      await expect(callJev("k-123456789", "t", {}, { fetch: f as unknown as typeof fetch, sleep, now })).rejects.toMatchObject({ kind });
    }
    const f = vi.fn().mockResolvedValue(new Response("<html>", { status: 500 }));
    resetJevThrottle();
    await expect(callJev("k-123456789", "t", {}, { fetch: f as unknown as typeof fetch, sleep, now })).rejects.toMatchObject({ kind: "unknown" });
  });

  it("maps a network failure and a cancel", async () => {
    const f = vi.fn().mockRejectedValue(new TypeError("x"));
    await expect(callJev("k-123456789", "t", {}, { fetch: f as unknown as typeof fetch, sleep, now })).rejects.toMatchObject({ kind: "network" });
    resetJevThrottle();
    const ac = new AbortController();
    ac.abort();
    const g = vi.fn().mockRejectedValue(new DOMException("a", "AbortError"));
    await expect(callJev("k-123456789", "t", {}, { fetch: g as unknown as typeof fetch, sleep, now, signal: ac.signal })).rejects.toMatchObject({ kind: "cancelled" });
  });

  it("retries once on 429 honoring retryAfterMs, capped at 3s", async () => {
    const f = vi.fn().mockResolvedValueOnce(err(429, "rate_limit", 9000)).mockResolvedValueOnce(ok({ a: { type: "noul", noul: 0.1 } }));
    const r = await callJev("k-123456789", "t", {}, { fetch: f as unknown as typeof fetch, sleep, now });
    expect(f).toHaveBeenCalledTimes(2);
    expect(sleeps[0]).toBe(3000);
    expect(r.answers.a).toBeDefined();
  });

  it("retries 529 with a short default wait, and gives up after the one retry", async () => {
    const f = vi.fn().mockImplementation(async () => err(529, "overloaded"));
    await expect(callJev("k-123456789", "t", {}, { fetch: f as unknown as typeof fetch, sleep, now })).rejects.toMatchObject({ kind: "overloaded" });
    expect(f).toHaveBeenCalledTimes(2);
    expect(sleeps[0]).toBe(1000);
  });

  it("does not retry other errors", async () => {
    const f = vi.fn().mockResolvedValue(err(401, "auth"));
    await expect(callJev("k-123456789", "t", {}, { fetch: f as unknown as typeof fetch, sleep, now })).rejects.toBeInstanceOf(JevError);
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("spaces requests at least 2 seconds apart", async () => {
    const f = vi.fn().mockImplementation(async () => ok({ a: { type: "noul", noul: 0.5 } }));
    const o = { fetch: f as unknown as typeof fetch, sleep, now };
    await callJev("k-123456789", "t", {}, o);
    expect(sleeps).toEqual([]);
    await callJev("k-123456789", "t", {}, o);
    expect(sleeps).toEqual([MIN_GAP_MS]);
  });
});

describe("testJevConnection", () => {
  it("reports success and failures plainly", async () => {
    const good = vi.fn().mockResolvedValue(ok({ t: { type: "noul", noul: 0.99 } }));
    expect(await testJevConnection("k-123456789", { fetch: good as unknown as typeof fetch, sleep, now })).toMatchObject({ ok: true });
    resetJevThrottle();
    const bad = vi.fn().mockResolvedValue(err(401, "auth"));
    const r = await testJevConnection("k-123456789", { fetch: bad as unknown as typeof fetch, sleep, now });
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/did not accept/);
    expect(r.message).not.toContain("k-123456789");
  });
});

describe("parseJevResult", () => {
  it("rejects a body without answers", () => {
    expect(() => parseJevResult({})).toThrow(JevError);
    expect(() => parseJevResult(null)).toThrow(JevError);
  });
});
