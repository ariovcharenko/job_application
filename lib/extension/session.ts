import { DEFAULT_EXTENSION_ID } from "./protocol";

// What this browser remembers about the extension: its ID and the pairing token the extension gave
// back after she confirmed. localStorage on purpose (per browser, never in a backup or the Dexie
// database): the token only works from this site's origin, and a restore on another machine must
// not pretend to be paired.

const ID_KEY = "job-copilot:extension-id";
const TOKEN_KEY = "job-copilot:extension-token";

function read(key: string): string {
  try {
    return localStorage.getItem(key) ?? "";
  } catch {
    return "";
  }
}
function write(key: string, value: string): void {
  try {
    if (value) localStorage.setItem(key, value);
    else localStorage.removeItem(key);
  } catch {
    // Storage blocked: pairing then lasts until the page closes only.
  }
}

/** A Chrome extension ID is 32 letters a to p. */
export const isExtensionId = (s: string) => /^[a-p]{32}$/.test(s);

export function getExtensionId(): string {
  const saved = read(ID_KEY).trim();
  return isExtensionId(saved) ? saved : DEFAULT_EXTENSION_ID;
}
export function setExtensionId(id: string): void {
  const v = id.trim();
  write(ID_KEY, v && v !== DEFAULT_EXTENSION_ID && isExtensionId(v) ? v : "");
}
export const getPairingToken = () => read(TOKEN_KEY);
export const setPairingToken = (t: string) => write(TOKEN_KEY, t);
export const SESSION_EVENT = "job-copilot:extension-session";
export function notifySessionChanged(): void {
  try {
    window.dispatchEvent(new Event(SESSION_EVENT));
  } catch {
    // no window (tests)
  }
}
