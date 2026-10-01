import { BLANK_SYNCED_DATA, type SyncedData } from "../types";

const DATA_KEY = "syncedData";
const APP_ORIGIN_KEY = "appOrigin";
const DEFAULT_APP_ORIGIN = "http://localhost:3000";

export async function getSyncedData(): Promise<SyncedData> {
  const stored = await chrome.storage.local.get(DATA_KEY);
  return { ...BLANK_SYNCED_DATA, ...(stored[DATA_KEY] as Partial<SyncedData> | undefined) };
}

export async function setSyncedData(data: SyncedData): Promise<void> {
  await chrome.storage.local.set({ [DATA_KEY]: data });
}

export async function getAppOrigin(): Promise<string> {
  const stored = await chrome.storage.local.get(APP_ORIGIN_KEY);
  return (stored[APP_ORIGIN_KEY] as string | undefined) || DEFAULT_APP_ORIGIN;
}

export async function setAppOrigin(origin: string): Promise<void> {
  await chrome.storage.local.set({ [APP_ORIGIN_KEY]: origin.replace(/\/+$/, "") });
}

export interface PendingCapture {
  text: string;
  url: string;
  capturedAt: number;
}

const PENDING_CAPTURE_KEY = "pendingCapture";

export async function setPendingCapture(capture: PendingCapture): Promise<void> {
  await chrome.storage.local.set({ [PENDING_CAPTURE_KEY]: capture });
}

export async function takePendingCapture(): Promise<PendingCapture | null> {
  const stored = await chrome.storage.local.get(PENDING_CAPTURE_KEY);
  const capture = stored[PENDING_CAPTURE_KEY] as PendingCapture | undefined;
  if (capture) await chrome.storage.local.remove(PENDING_CAPTURE_KEY);
  return capture ?? null;
}

export { DEFAULT_APP_ORIGIN };
