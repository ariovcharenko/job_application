import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { FEATURES } from "../lib/features";
import { startExtensionBridge, type BridgeWindow } from "./ExtensionBridge";

// M7: with the extension flag off, the public site must never post anything (the API key,
// Profile, resume) to window.postMessage, where any other extension on the page could read it.

function fakeWindow() {
  return {
    postMessage: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    location: { origin: "https://job-copilot.example" },
  } satisfies BridgeWindow;
}

describe("extension bridge", () => {
  it("is off in the public build", () => {
    expect(FEATURES.extension).toBe(false);
  });

  it("makes zero postMessage calls and adds no listener with the flag off", async () => {
    const win = fakeWindow();
    const stop = startExtensionBridge(win);
    await new Promise((r) => setTimeout(r, 20));
    expect(win.postMessage).not.toHaveBeenCalled();
    expect(win.addEventListener).not.toHaveBeenCalled();
    stop();
  });

  it("only runs when explicitly enabled (proves the spy would catch it)", async () => {
    const win = fakeWindow();
    const stop = startExtensionBridge(win, true);
    await vi.waitFor(() => expect(win.postMessage).toHaveBeenCalledTimes(1));
    expect(win.addEventListener).toHaveBeenCalledWith("message", expect.any(Function));
    stop();
    expect(win.removeEventListener).toHaveBeenCalled();
  });

  it("is mounted in the layout only behind the flag", () => {
    const layout = readFileSync(fileURLToPath(new URL("../app/layout.tsx", import.meta.url)), "utf8");
    const mounts = layout.match(/<ExtensionBridge\s*\/>/g) ?? [];
    expect(mounts).toHaveLength(1);
    expect(layout).toContain("{FEATURES.extension && <ExtensionBridge />}");
  });
});
