import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db, saveProfile, saveSettings, saveMasterProfile } from "../db";
import { blankApplication } from "../tracker/blank";
import { DEFAULT_PROFILE } from "../defaults";
import { ExtensionLink, type LinkStatus } from "./link";
import { handleRequest, type HandlerDeps } from "./handlers";
import { buildSyncedData } from "./payload";
import { detectExtension, disconnectExtension, pairWithExtension } from "./pairing";
import { DEFAULT_EXTENSION_ID, PROTOCOL_VERSION } from "./protocol";
import { getExtensionId, getPairingToken, setExtensionId } from "./session";
import type { PortLike, RuntimeLike } from "./client";
import { installBrowser } from "./testBrowser";

const MASTER = `# Experience
**Software Engineer Intern | Brightloop | Chicago, IL | May 2026 - Aug 2026**
- Built a queue that cut latency 40%.
- Wrote tests.
`;

beforeEach(async () => {
  installBrowser();
  await Promise.all(db.tables.map((t) => t.clear()));
});

describe("payload", () => {
  it("sends profile, answers, experience and a jobs index, and no key anywhere", async () => {
    await saveProfile({ ...DEFAULT_PROFILE, fullName: "Alex Rivera", email: "alex@example.com", authorizedToWorkUS: "yes" });
    await saveSettings({ anthropicKey: "sk-ant-SECRET", openaiKey: "sk-openai-SECRET", jsearchApiKey: "rapid-SECRET", jevKey: "jev-SECRET" });
    await saveMasterProfile(MASTER);
    await db.applications.add({ ...blankApplication(), company: "Taskwise", role: "SWE", url: "https://boards.greenhouse.io/taskwise/jobs/1234567" });
    await db.applications.add({ ...blankApplication(), company: "Skipped Co", role: "X", triage: "skipped" });
    const data = await buildSyncedData(5);
    expect(data.profile.fullName).toBe("Alex Rivera");
    expect(data.profile.authorizedToWorkUS).toBe("yes");
    expect(data.jobs).toEqual([{ id: expect.any(Number), company: "Taskwise", role: "SWE", url: "https://boards.greenhouse.io/taskwise/jobs/1234567", stage: "Saved" }]);
    expect(data.experiences[0]).toMatchObject({ company: "Brightloop", bullets: ["Built a queue that cut latency 40%.", "Wrote tests."] });
    const json = JSON.stringify(data);
    expect(json).not.toMatch(/SECRET|sk-ant|sk-openai/);
    expect(json).not.toMatch(/apiKey|anthropicKey|openaiKey|jevKey/i);
  });
});

function deps(over: Partial<HandlerDeps> = {}): HandlerDeps {
  return {
    buildData: vi.fn(async () => ({ profile: {} as never, answerBank: [], masterProfile: "", experiences: [], jobs: [], updatedAt: 1 })),
    storeCapture: vi.fn(),
    showDraft: vi.fn(),
    getResume: vi.fn(async () => null),
    saveAnswer: vi.fn(async () => ({ saved: true, duplicate: false })),
    markApplied: vi.fn(async () => ({ jobId: 1, appliedDate: "2026-10-01", followUpDate: "2026-10-08", created: false })),
    ...over,
  };
}

describe("handleRequest", () => {
  it("validates captured text and draft requests", async () => {
    const d = deps();
    await expect(handleRequest("capturedJob", { text: "short", url: "u" }, d)).rejects.toThrow();
    await expect(handleRequest("draftRequest", { requestId: "", question: "q" }, d)).rejects.toThrow();
    await expect(handleRequest("nope" as never, {}, d)).rejects.toThrow();
    await handleRequest("capturedJob", { text: "x".repeat(80), url: "https://a.example/job" }, d);
    expect(d.storeCapture).toHaveBeenCalledOnce();
    await handleRequest("draftRequest", { requestId: "r1", question: "Why us?", jobText: "t", pageUrl: "u", jobId: 3 }, d);
    expect(d.showDraft).toHaveBeenCalledWith({ requestId: "r1", question: "Why us?", jobText: "t", pageUrl: "u", jobId: 3 });
  });
});

function fakePort() {
  let onMsg: (m: unknown) => void = () => {};
  let onDisc: () => void = () => {};
  const port = {
    sent: [] as unknown[],
    postMessage(m: unknown) {
      port.sent.push(m);
    },
    disconnect: vi.fn(),
    onMessage: { addListener: (f: (m: unknown) => void) => void (onMsg = f) },
    onDisconnect: { addListener: (f: () => void) => void (onDisc = f) },
    receive: (m: unknown) => onMsg(m),
    drop: () => onDisc(),
  };
  return port;
}

describe("ExtensionLink", () => {
  it("does not connect without a token or a runtime", () => {
    const rt: RuntimeLike = { sendMessage: vi.fn(), connect: vi.fn() };
    expect(new ExtensionLink({ runtime: rt, extensionId: "a".repeat(32), token: "", deps: deps(), onStatus: () => {} }).connect()).toBe(false);
    expect(new ExtensionLink({ runtime: null, extensionId: "a".repeat(32), token: "t", deps: deps(), onStatus: () => {} }).connect()).toBe(false);
    expect(rt.connect).not.toHaveBeenCalled();
  });

  it("says hello with the token, pushes data after welcome, answers requests, reports errors", async () => {
    const port = fakePort();
    const rt: RuntimeLike = { sendMessage: vi.fn(), connect: vi.fn(() => port as unknown as PortLike) };
    const statuses: LinkStatus[] = [];
    const d = deps();
    const link = new ExtensionLink({ runtime: rt, extensionId: "b".repeat(32), token: "tok", deps: d, onStatus: (s) => statuses.push(s) });
    expect(link.connect()).toBe(true);
    expect(port.sent[0]).toEqual({ kind: "hello", token: "tok", protocol: PROTOCOL_VERSION });
    port.receive({ kind: "welcome" });
    await vi.waitFor(() => expect(port.sent).toHaveLength(2));
    expect(port.sent[1]).toMatchObject({ kind: "push", method: "sync" });
    expect(statuses).toEqual(["connecting", "connected"]);

    port.receive({ kind: "req", id: "1", method: "sync", params: {} });
    await vi.waitFor(() => expect(port.sent).toHaveLength(3));
    expect(port.sent[2]).toMatchObject({ kind: "res", id: "1" });

    port.receive({ kind: "req", id: "2", method: "draftRequest", params: {} });
    await vi.waitFor(() => expect(port.sent).toHaveLength(4));
    expect(port.sent[3]).toMatchObject({ kind: "res", id: "2", error: expect.any(String) });

    expect(link.sendDraftResult({ requestId: "r", answer: "a" })).toBe(true);
    port.drop();
    expect(statuses.at(-1)).toBe("idle");
    expect(link.sendDraftResult({ requestId: "r", answer: "a" })).toBe(false);
  });

  it("stays rejected (no silent retries) when the extension refuses the token", () => {
    const port = fakePort();
    const statuses: LinkStatus[] = [];
    const link = new ExtensionLink({ runtime: { sendMessage: vi.fn(), connect: () => port as unknown as PortLike }, extensionId: "b".repeat(32), token: "bad", deps: deps(), onStatus: (s) => statuses.push(s) });
    link.connect();
    port.receive({ kind: "rejected", reason: "not-paired" });
    port.drop();
    expect(statuses.at(-1)).toBe("rejected");
  });
});

function runtimeReplying(replies: Record<string, unknown[]>): RuntimeLike {
  const calls: Record<string, number> = {};
  return {
    connect: vi.fn(),
    sendMessage: (_id, message, cb) => {
      const type = (message as { type: string }).type;
      const i = calls[type] ?? 0;
      calls[type] = i + 1;
      const list = replies[type] ?? [];
      cb(list[Math.min(i, list.length - 1)]);
    },
  };
}

describe("pairing", () => {
  it("detects absent, unpaired, stale and paired", async () => {
    expect((await detectExtension(null, "x", "")).kind).toBe("absent");
    expect((await detectExtension(runtimeReplying({ PING: [undefined] }), "x", "")).kind).toBe("absent");
    expect((await detectExtension(runtimeReplying({ PING: [{ ok: true, version: "1", protocol: 1, paired: false }] }), "x", "")).kind).toBe("unpaired");
    expect((await detectExtension(runtimeReplying({ PING: [{ ok: true, version: "1", protocol: 1, paired: false }] }), "x", "old")).kind).toBe("stale");
    expect((await detectExtension(runtimeReplying({ PING: [{ ok: true, version: "1", protocol: 1, paired: true }] }), "x", "t")).kind).toBe("paired");
  });

  it("shows the code, waits for her click, then stores the token", async () => {
    const rt = runtimeReplying({ PAIR_START: [{ ok: true, code: "123456" }], PAIR_STATUS: [{ status: "pending" }, { status: "approved", token: "tok-1" }] });
    const codes: string[] = [];
    expect(await pairWithExtension(rt, "x", { onCode: (c) => codes.push(c), sleep: async () => {} })).toBe("approved");
    expect(codes).toEqual(["123456"]);
    expect(getPairingToken()).toBe("tok-1");
  });

  it("stores nothing when she denies, and reports an unreachable extension", async () => {
    const denied = runtimeReplying({ PAIR_START: [{ ok: true, code: "1" }], PAIR_STATUS: [{ status: "denied" }] });
    expect(await pairWithExtension(denied, "x", { onCode: () => {}, sleep: async () => {} })).toBe("denied");
    expect(getPairingToken()).toBe("");
    expect(await pairWithExtension(null, "x", { onCode: () => {} })).toBe("unreachable");
  });

  it("disconnect forgets the token", async () => {
    localStorage.setItem("job-copilot:extension-token", "t");
    await disconnectExtension(runtimeReplying({ UNPAIR: [{ ok: true }] }), "x", "t");
    expect(getPairingToken()).toBe("");
  });
});

describe("extension id", () => {
  it("defaults to the ID derived from the manifest key and accepts only valid overrides", () => {
    expect(getExtensionId()).toBe(DEFAULT_EXTENSION_ID);
    setExtensionId("not an id");
    expect(getExtensionId()).toBe(DEFAULT_EXTENSION_ID);
    setExtensionId("a".repeat(32));
    expect(getExtensionId()).toBe("a".repeat(32));
  });

  it("DEFAULT_EXTENSION_ID matches the key in extension/manifest.json", async () => {
    const { createHash } = await import("node:crypto");
    const manifest = JSON.parse(readFileSync(fileURLToPath(new URL("../../extension/manifest.json", import.meta.url)), "utf8"));
    const hex = createHash("sha256").update(Buffer.from(manifest.key, "base64")).digest("hex").slice(0, 32);
    expect([...hex].map((c) => String.fromCharCode(97 + parseInt(c, 16))).join("")).toBe(DEFAULT_EXTENSION_ID);
  });
});

describe("protocol copies agree", () => {
  it("has the same version, port name and app origins as the extension", () => {
    const ext = readFileSync(fileURLToPath(new URL("../../extension/src/protocol.ts", import.meta.url)), "utf8");
    expect(ext).toContain(`PROTOCOL_VERSION = ${PROTOCOL_VERSION};`);
    expect(ext).toContain('PORT_NAME = "job-copilot-app"');
    const manifest = JSON.parse(readFileSync(fileURLToPath(new URL("../../extension/manifest.json", import.meta.url)), "utf8"));
    for (const m of manifest.externally_connectable.matches as string[]) expect(ext).toContain(m.replace("/*", ""));
  });
});

describe("saveAnswerFromExtension", () => {
  it("adds a new answer, ignores a repeat of the same question, and refuses legal questions", async () => {
    const { saveAnswerFromExtension } = await import("./answers");
    expect(await saveAnswerFromExtension("Why do you want to work here?", "Because I like queues.")).toEqual({ saved: true, duplicate: false });
    expect(await saveAnswerFromExtension("why do you want to work here", "Something else")).toEqual({ saved: false, duplicate: true });
    const rows = await db.answerBank.toArray();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ answer: "Because I like queues.", tags: ["from extension"] });
    await expect(saveAnswerFromExtension("Are you authorized to work in the US?", "Yes")).rejects.toThrow(/legal or identity/);
    expect(await db.answerBank.count()).toBe(1);
  });
});

describe("markAppliedFromExtension", () => {
  it("moves a saved job to Applied with a follow-up a week later and keeps the fill time", async () => {
    const { markAppliedFromExtension } = await import("./applied");
    const id = (await db.applications.add({ ...blankApplication(), company: "Taskwise", role: "SWE", url: "https://boards.greenhouse.io/taskwise/jobs/4012345", triage: "checked" })) as number;
    const r = await markAppliedFromExtension({ jobId: id, url: "https://boards.greenhouse.io/taskwise/jobs/4012345/confirmation", company: "", role: "", fillSeconds: 214 }, "2026-10-01");
    expect(r).toEqual({ jobId: id, appliedDate: "2026-10-01", followUpDate: "2026-10-08", created: false });
    const row = await db.applications.get(id);
    expect(row).toMatchObject({ stage: "Applied", appliedDate: "2026-10-01", followUpDate: "2026-10-08", fillSeconds: 214 });
    expect(row?.triage).toBeUndefined();
  });

  it("finds the job by company and role when no id was matched", async () => {
    const { markAppliedFromExtension } = await import("./applied");
    const id = (await db.applications.add({ ...blankApplication(), company: "Brightloop", role: "Backend Engineer" })) as number;
    const r = await markAppliedFromExtension({ jobId: null, url: "https://x.example/a", company: "Brightloop", role: "Backend Engineer" }, "2026-10-01");
    expect(r.jobId).toBe(id);
    expect((await db.applications.get(id))?.stage).toBe("Applied");
  });

  it("leaves a job that is already Applied or further untouched", async () => {
    const { markAppliedFromExtension } = await import("./applied");
    const id = (await db.applications.add({ ...blankApplication(), company: "A", role: "B", stage: "Waiting for interview", appliedDate: "2026-09-01", followUpDate: "2026-09-08" })) as number;
    const r = await markAppliedFromExtension({ jobId: id, url: "", company: "", role: "", fillSeconds: 5 }, "2026-10-01");
    expect(r).toMatchObject({ created: false, appliedDate: "2026-09-01" });
    expect(await db.applications.get(id)).toMatchObject({ stage: "Waiting for interview", appliedDate: "2026-09-01" });
    expect((await db.applications.get(id))?.fillSeconds).toBeUndefined();
  });

  it("adds a row for a page that isn't a saved job, and refuses when nothing is known", async () => {
    const { markAppliedFromExtension } = await import("./applied");
    const r = await markAppliedFromExtension({ jobId: null, url: "https://jobs.lever.co/x/1", company: "Taskwise", role: "SWE" }, "2026-10-01");
    expect(r.created).toBe(true);
    expect(await db.applications.get(r.jobId)).toMatchObject({ stage: "Applied", source: "Chrome extension", followUpDate: "2026-10-08" });
    await expect(markAppliedFromExtension({ jobId: null, url: "", company: "", role: "" })).rejects.toThrow(/didn't say which job/);
  });
});
