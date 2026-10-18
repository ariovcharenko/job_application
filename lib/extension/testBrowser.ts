import { vi } from "vitest";

/** Minimal `localStorage` and `window` for tests (the root suite runs under Node, not jsdom). */
export function installBrowser() {
  const store = new Map<string, string>();
  const localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
  };
  const win = Object.assign(new EventTarget(), { postMessage: vi.fn(), location: { pathname: "/", assign: vi.fn() } });
  vi.stubGlobal("localStorage", localStorage);
  vi.stubGlobal("window", win);
  vi.stubGlobal("document", { visibilityState: "visible" });
  return { localStorage, window: win };
}
