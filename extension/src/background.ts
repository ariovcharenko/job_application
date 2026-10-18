// Service worker. Owns the connection to the Job Copilot app (lib/bridgeCore.ts) and answers the
// content script, popup and pairing window. Never stores or forwards an API key, never submits a
// form, never runs on LinkedIn, Indeed or Jobright.
import { Bridge, NotConnectedError, randomHex, randomSixDigits } from "./lib/bridgeCore";
import { isBlockedHost } from "./lib/hosts";
import { matchJob } from "./lib/jobMatch";
import { chromeKV, getSyncedData, scrubLegacy } from "./lib/storage";
import type { ContextReply, FillSession, InternalMessage, ResumeReply, SimpleReply, TabMessage } from "./messages";
import { APP_ORIGINS, isAppOrigin, type DraftResult, type ResumeFile } from "./protocol";

const CONTENT_SCRIPT = "content/capture.js";
const SITE_SCRIPT_PREFIX = "site:";

const bridge = new Bridge({
  kv: chromeKV,
  now: () => Date.now(),
  randomToken: () => randomHex(32),
  randomCode: randomSixDigits,
  version: chrome.runtime.getManifest().version,
  async openPairWindow(origin, code) {
    const url = chrome.runtime.getURL(`pair.html?origin=${encodeURIComponent(origin)}&code=${code}`);
    await chrome.windows.create({ url, type: "popup", width: 420, height: 420, focused: true });
  },
  async openApp(origin, { active, path }) {
    const tab = await chrome.tabs.create({ url: `${origin}${path}`, active });
    return tab.id;
  },
  async closeTab(tabId) {
    await chrome.tabs.remove(tabId);
  },
  async focusTab(tabId) {
    const tab = await chrome.tabs.update(tabId, { active: true });
    if (tab?.windowId !== undefined) await chrome.windows.update(tab.windowId, { focused: true });
  },
  onPush(method, params) {
    if (method === "draftResult" || method === "draftCancelled") void deliverDraft(method, params as DraftResult);
  },
});

// ---------------- App -> extension ----------------

chrome.runtime.onMessageExternal.addListener((message, sender, sendResponse) => {
  bridge
    .handleExternal(message, sender.origin ?? originOf(sender.url))
    .then((reply) => sendResponse(reply))
    .catch(() => sendResponse(undefined));
  return true;
});

chrome.runtime.onConnectExternal.addListener((port) => bridge.handleConnect(port));

// ---------------- Drafts (answer approved in the app comes back here) ----------------

interface PendingDraft {
  tabId: number;
  fieldKey: string;
}

async function pendingDrafts(): Promise<Record<string, PendingDraft>> {
  return ((await chrome.storage.session.get("drafts")).drafts as Record<string, PendingDraft> | undefined) ?? {};
}

async function deliverDraft(method: string, params: DraftResult | { requestId: string }): Promise<void> {
  const drafts = await pendingDrafts();
  const d = drafts[params.requestId];
  if (!d) return;
  delete drafts[params.requestId];
  await chrome.storage.session.set({ drafts });
  const msg: TabMessage =
    method === "draftResult"
      ? { type: "DRAFT_READY", requestId: params.requestId, fieldKey: d.fieldKey, answer: (params as DraftResult).answer }
      : { type: "DRAFT_CANCELLED", requestId: params.requestId, fieldKey: d.fieldKey };
  await chrome.tabs.sendMessage(d.tabId, msg).catch(() => {});
  if (method === "draftResult") {
    const tab = await chrome.tabs.update(d.tabId, { active: true }).catch(() => undefined);
    if (tab?.windowId !== undefined) await chrome.windows.update(tab.windowId, { focused: true }).catch(() => {});
  }
}

// ---------------- Fill sessions (for "Mark as applied" after she submits) ----------------

const FILL_SESSION_MAX_MS = 6 * 60 * 60 * 1000;

async function fillSessions(): Promise<Record<string, FillSession>> {
  return ((await chrome.storage.session.get("fills")).fills as Record<string, FillSession> | undefined) ?? {};
}

// ---------------- Content script / popup / pairing window -> background ----------------

const isOwnPage = (sender: chrome.runtime.MessageSender, page: string) => !!sender.url?.startsWith(chrome.runtime.getURL(page));

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

async function handleInternal(msg: InternalMessage, sender: chrome.runtime.MessageSender): Promise<unknown> {
  const tabId = sender.tab?.id;
  const fromContent = !!sender.tab && !sender.url?.startsWith(chrome.runtime.getURL(""));
  if (fromContent && sender.url) {
    try {
      if (isBlockedHost(new URL(sender.url).hostname)) return { ok: false, error: "Job Copilot doesn't run on this site." };
    } catch {
      return { ok: false, error: "Unknown page." };
    }
  }

  switch (msg.type) {
    case "GET_CONTEXT": {
      // Ask the open app for fresh data; fall back to the last copy.
      if (bridge.isConnected()) {
        try {
          const fresh = await bridge.request("sync", {}, { timeoutMs: 2500 });
          if (!("queued" in fresh)) await chromeKV.set("syncedData", fresh);
        } catch {
          /* use the stored copy */
        }
      }
      const data = await getSyncedData();
      const reply: ContextReply = {
        data,
        paired: (await bridge.pairedOrigins()).length > 0,
        connected: bridge.isConnected(),
        match: matchJob(data.jobs, msg.url, msg.page),
      };
      return reply;
    }

    case "CAPTURE_JOB": {
      try {
        await bridge.request("capturedJob", { text: msg.text, url: msg.url }, { openApp: "foreground" });
        await bridge.focusApp();
        return { ok: true } satisfies SimpleReply;
      } catch (e) {
        return { ok: false, error: errorText(e) } satisfies SimpleReply;
      }
    }

    case "DRAFT_REQUEST": {
      if (tabId === undefined) return { ok: false, error: "No tab." };
      const requestId = randomHex(8);
      const drafts = await pendingDrafts();
      drafts[requestId] = { tabId, fieldKey: msg.fieldKey };
      await chrome.storage.session.set({ drafts });
      try {
        await bridge.request(
          "draftRequest",
          { requestId, question: msg.question.slice(0, 1000), jobText: msg.jobText.slice(0, 8000), pageUrl: msg.pageUrl, jobId: msg.jobId },
          { openApp: "foreground", timeoutMs: 10_000 },
        );
        await bridge.focusApp();
        return { ok: true, detail: requestId } satisfies SimpleReply;
      } catch (e) {
        return { ok: false, error: errorText(e) } satisfies SimpleReply;
      }
    }

    case "GET_RESUME": {
      try {
        const res = await bridge.request("getResume", { jobId: msg.jobId }, { openApp: "background", timeoutMs: 30_000 });
        return { ok: true, resume: res && "queued" in res ? null : (res as ResumeFile | null) } satisfies ResumeReply;
      } catch (e) {
        return { ok: false, error: e instanceof NotConnectedError ? e.message : `Couldn't get a resume from Job Copilot: ${errorText(e)}` } satisfies ResumeReply;
      }
    }

    case "SAVE_ANSWER": {
      try {
        const res = await bridge.request("saveAnswer", { question: msg.question.slice(0, 500), answer: msg.answer.slice(0, 5000) }, { queue: true });
        return { ok: true, queued: "queued" in res } satisfies SimpleReply;
      } catch (e) {
        return { ok: false, error: errorText(e) } satisfies SimpleReply;
      }
    }

    case "FILL_STARTED": {
      if (tabId === undefined) return { ok: false, error: "No tab." };
      const fills = await fillSessions();
      const existing = fills[tabId];
      // The first Fill click starts the clock; later clicks (next Workday step) keep it.
      if (!existing || Date.now() - existing.startedAt > FILL_SESSION_MAX_MS) {
        fills[tabId] = { jobId: msg.jobId, url: msg.url, company: msg.company, role: msg.role, startedAt: Date.now() };
        await chrome.storage.session.set({ fills });
      }
      return { ok: true };
    }

    case "GET_FILL_SESSION": {
      if (tabId === undefined) return null;
      const s = (await fillSessions())[tabId];
      return s && Date.now() - s.startedAt < FILL_SESSION_MAX_MS ? s : null;
    }

    case "END_FILL_SESSION": {
      if (tabId === undefined) return { ok: true };
      const fills = await fillSessions();
      delete fills[tabId];
      await chrome.storage.session.set({ fills });
      return { ok: true };
    }

    case "MARK_APPLIED": {
      if (tabId === undefined) return { ok: false, error: "No tab." };
      const fills = await fillSessions();
      const s = fills[tabId];
      const fillSeconds = s ? Math.round((Date.now() - s.startedAt) / 1000) : undefined;
      try {
        const res = await bridge.request(
          "markApplied",
          { jobId: msg.jobId ?? s?.jobId ?? null, url: msg.url || s?.url || "", company: msg.company || s?.company || "", role: msg.role || s?.role || "", fillSeconds },
          { queue: true },
        );
        delete fills[tabId];
        await chrome.storage.session.set({ fills });
        return { ok: true, queued: "queued" in res, detail: fillSeconds !== undefined ? String(fillSeconds) : undefined } satisfies SimpleReply;
      } catch (e) {
        return { ok: false, error: errorText(e) } satisfies SimpleReply;
      }
    }

    case "GET_PENDING_PAIR":
      if (!isOwnPage(sender, "pair.html")) return null;
      return (await bridge.pendingPairing()) ?? null;

    case "PAIR_DECISION":
      if (!isOwnPage(sender, "pair.html")) return { ok: false };
      return { ok: await bridge.decidePairing(msg.code, msg.allow) };

    case "POPUP_STATUS": {
      if (!isOwnPage(sender, "popup.html")) return null;
      const data = await getSyncedData();
      return {
        paired: await bridge.pairedOrigins(),
        connected: bridge.isConnected(),
        appOrigin: (await bridge.appOrigin()) ?? APP_ORIGINS[0],
        updatedAt: data.updatedAt,
        jobs: data.jobs.length,
        hasProfile: !!data.profile.fullName,
      };
    }

    case "SET_APP_ORIGIN":
      if (!isOwnPage(sender, "popup.html") || !isAppOrigin(msg.origin)) return { ok: false };
      await chromeKV.set("appOrigin", msg.origin);
      return { ok: true };

    case "UNPAIR_ORIGIN":
      if (!isOwnPage(sender, "popup.html") || !isAppOrigin(msg.origin)) return { ok: false };
      await bridge.unpair(msg.origin);
      return { ok: true };

    case "SITE_ENABLED": {
      if (!isOwnPage(sender, "popup.html")) return { ok: false };
      await registerSite(msg.pattern);
      if (msg.tabId !== undefined) await chrome.scripting.executeScript({ target: { tabId: msg.tabId }, files: [CONTENT_SCRIPT] }).catch(() => {});
      return { ok: true };
    }

    case "SITE_DISABLED": {
      if (!isOwnPage(sender, "popup.html")) return { ok: false };
      await unregisterSite(msg.pattern);
      await chrome.permissions.remove({ origins: [msg.pattern] }).catch(() => false);
      return { ok: true };
    }

    default:
      return undefined;
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id) return false;
  handleInternal(message as InternalMessage, sender)
    .then(sendResponse)
    .catch((e) => sendResponse({ ok: false, error: errorText(e) }));
  return true;
});

// ---------------- Sites she turned on with "Use on this site" ----------------

async function registerSite(pattern: string): Promise<void> {
  const host = pattern.replace(/^https?:\/\//, "").replace(/\/\*$/, "");
  if (isBlockedHost(host)) return;
  const id = SITE_SCRIPT_PREFIX + pattern;
  const existing = await chrome.scripting.getRegisteredContentScripts({ ids: [id] });
  if (existing.length) return;
  await chrome.scripting.registerContentScripts([{ id, matches: [pattern], js: [CONTENT_SCRIPT], runAt: "document_idle", persistAcrossSessions: true }]);
}

async function unregisterSite(pattern: string): Promise<void> {
  const id = SITE_SCRIPT_PREFIX + pattern;
  const existing = await chrome.scripting.getRegisteredContentScripts({ ids: [id] });
  if (existing.length) await chrome.scripting.unregisterContentScripts({ ids: [id] });
}

chrome.permissions.onRemoved.addListener((removed) => {
  for (const origin of removed.origins ?? []) void unregisterSite(origin);
});

// ---------------- Install / update ----------------

chrome.runtime.onInstalled.addListener(async () => {
  // Older versions mirrored the Anthropic key and registered a postMessage bridge script.
  const all = await chrome.storage.local.get(null);
  const { set, remove } = scrubLegacy(all);
  if (Object.keys(set).length) await chrome.storage.local.set(set);
  if (remove.length) await chrome.storage.local.remove(remove);
  const old = await chrome.scripting.getRegisteredContentScripts({ ids: ["job-copilot-bridge"] }).catch(() => []);
  if (old.length) await chrome.scripting.unregisterContentScripts({ ids: ["job-copilot-bridge"] });
});

function originOf(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    return new URL(url).origin;
  } catch {
    return undefined;
  }
}
