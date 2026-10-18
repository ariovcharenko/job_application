import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installBrowser } from "../lib/extension/testBrowser";
import { startExtensionBridge } from "./ExtensionBridge";

// With no extension installed (no chrome.runtime) or no pairing token, the bridge must do nothing:
// no message, no connection, no listener on the page's message channel (the old bridge posted the
// API key to window.postMessage, where any other extension on the page could read it).

let win: ReturnType<typeof installBrowser>["window"];
beforeEach(() => {
  win = installBrowser().window;
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("extension bridge", () => {
  it("does nothing without a pairing token, even when chrome.runtime exists", () => {
    const connect = vi.fn();
    vi.stubGlobal("chrome", { runtime: { sendMessage: vi.fn(), connect } });
    const post = win.postMessage;
    const stop = startExtensionBridge(true);
    expect(connect).not.toHaveBeenCalled();
    expect(post).not.toHaveBeenCalled();
    stop();
  });

  it("does nothing outside Chrome even with a token", () => {
    localStorage.setItem("job-copilot:extension-token", "t");
    const post = win.postMessage;
    const stop = startExtensionBridge(true);
    expect(post).not.toHaveBeenCalled();
    stop();
  });

  it("connects by extension ID when paired, and never uses window.postMessage", () => {
    localStorage.setItem("job-copilot:extension-token", "tok");
    const port = { postMessage: vi.fn(), disconnect: vi.fn(), onMessage: { addListener: vi.fn() }, onDisconnect: { addListener: vi.fn() } };
    const connect = vi.fn(() => port);
    vi.stubGlobal("chrome", { runtime: { sendMessage: vi.fn(), connect } });
    const post = win.postMessage;
    const stop = startExtensionBridge(true);
    expect(connect).toHaveBeenCalledWith(expect.stringMatching(/^[a-p]{32}$/), { name: "job-copilot-app" });
    expect(port.postMessage).toHaveBeenCalledWith({ kind: "hello", token: "tok", protocol: 1 });
    expect(post).not.toHaveBeenCalled();
    stop();
    expect(port.disconnect).toHaveBeenCalled();
  });

  it("is off when the flag is off", () => {
    localStorage.setItem("job-copilot:extension-token", "tok");
    const connect = vi.fn();
    vi.stubGlobal("chrome", { runtime: { sendMessage: vi.fn(), connect } });
    startExtensionBridge(false)();
    expect(connect).not.toHaveBeenCalled();
  });

  it("is mounted in the layout only behind the flag", () => {
    const layout = readFileSync(fileURLToPath(new URL("../app/layout.tsx", import.meta.url)), "utf8");
    const mounts = layout.match(/<ExtensionBridge\s*\/>/g) ?? [];
    expect(mounts).toHaveLength(1);
    expect(layout).toContain("{FEATURES.extension && <ExtensionBridge />}");
  });

  it("never reads an API key anywhere in the extension code", () => {
    const dir = fileURLToPath(new URL("../lib/extension/", import.meta.url));
    for (const f of ["payload.ts", "handlers.ts", "link.ts", "client.ts", "appDeps.ts"]) {
      expect(readFileSync(dir + f, "utf8"), f).not.toMatch(/anthropicKey|openaiKey|jsearchApiKey|getSettings/);
    }
  });
});
