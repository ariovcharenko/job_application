// Shared between ExtensionBridge (writes, on receiving a capture from the Chrome extension) and
// TrackerView (reads, to prefill the paste-job dialog). sessionStorage survives the moment
// between the extension posting the message and the tracker page's effect running, without
// needing a global store for something this small and single-use.

export const CAPTURE_EVENT = "job-copilot:captured-job";
const STORAGE_KEY = "job-copilot:captured-job";

export interface CapturedJob {
  text: string;
  url: string;
}

export function storeCapturedJob(capture: CapturedJob): void {
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(capture));
  window.dispatchEvent(new CustomEvent<CapturedJob>(CAPTURE_EVENT, { detail: capture }));
}

export function takeCapturedJob(): CapturedJob | null {
  let raw: string | null = null;
  try {
    // Throws a SecurityError when the browser blocks site data; that must not crash the tracker.
    raw = sessionStorage.getItem(STORAGE_KEY);
    if (raw) sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    return JSON.parse(raw) as CapturedJob;
  } catch {
    return null;
  }
}
