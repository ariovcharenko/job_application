import { describe, expect, it, vi } from "vitest";
import { readViaServer } from "./readerClient";

const POSTING = { title: "Engineer", company: "Brightloop", locations: [], employmentType: "", datePosted: "", validThrough: "", salary: "", identifier: "", descriptionText: "x" };
const reply = (ok: boolean, body: unknown) => async () => ({ ok, json: async () => body });

describe("readViaServer", () => {
  it("posts only the link to the app's own route", async () => {
    const f = vi.fn(reply(true, { posting: POSTING, closed: false }));
    const out = await readViaServer("https://careers.brightloop.example/j/1", f);
    expect(out).toEqual({ kind: "posting", posting: POSTING, closed: false });
    expect(f).toHaveBeenCalledTimes(1);
    const [url, init] = f.mock.calls[0] as unknown as [string, { method: string; body: string }];
    expect(url).toBe("/api/read-posting");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({ url: "https://careers.brightloop.example/j/1" });
  });

  it("carries the closed flag, with or without a posting", async () => {
    expect(await readViaServer("https://x.example/", reply(true, { posting: POSTING, closed: true }))).toMatchObject({ kind: "posting", closed: true });
    expect(await readViaServer("https://x.example/", reply(false, { error: { kind: "no_posting" }, closed: true }))).toEqual({ kind: "none", closed: true, reason: "no_posting" });
    expect(await readViaServer("https://x.example/", reply(false, { error: { kind: "blocked_host" } }))).toEqual({ kind: "none", closed: false, reason: "blocked_host" });
  });

  it("any failure is none, never a throw", async () => {
    expect(
      await readViaServer("https://x.example/", async () => {
        throw new TypeError("Failed to fetch");
      }),
    ).toMatchObject({ kind: "none", closed: false });
    expect(
      await readViaServer("https://x.example/", async () => ({
        ok: false,
        json: async () => {
          throw new SyntaxError("not json");
        },
      })),
    ).toMatchObject({ kind: "none" });
    expect(await readViaServer("https://x.example/", reply(true, { posting: "nope" }))).toMatchObject({ kind: "none" });
  });

  it("runs one call at a time", async () => {
    let active = 0;
    let peak = 0;
    const f = async () => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 10));
      active--;
      return { ok: true, json: async () => ({ posting: POSTING, closed: false }) };
    };
    await Promise.all([1, 2, 3, 4].map((i) => readViaServer(`https://x.example/${i}`, f)));
    expect(peak).toBe(1);
  });
});
