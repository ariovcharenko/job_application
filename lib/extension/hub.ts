import type { DraftRequest, DraftResult } from "./protocol";
import type { ExtensionLink, LinkStatus } from "./link";

// A tiny shared state between the bridge component (which owns the connection), the Settings card
// (which shows its status) and the draft dialog (which answers through it). Module-level on
// purpose: these are three unrelated places in the React tree and the data is small and local.

let link: ExtensionLink | null = null;
let status: LinkStatus = "idle";
const pendingDrafts: DraftRequest[] = [];
const listeners = new Set<() => void>();

export const subscribeHub = (fn: () => void) => {
  listeners.add(fn);
  return () => void listeners.delete(fn);
};
const emit = () => listeners.forEach((fn) => fn());

export function setLink(next: ExtensionLink | null): void {
  link = next;
  if (!next) status = "idle";
  emit();
}
export function setLinkStatus(s: LinkStatus): void {
  status = s;
  emit();
}
export const getLinkStatus = () => status;

export function addDraftRequest(req: DraftRequest): void {
  if (!pendingDrafts.some((d) => d.requestId === req.requestId)) pendingDrafts.push(req);
  emit();
}
export const nextDraftRequest = (): DraftRequest | undefined => pendingDrafts[0];
export function finishDraftRequest(requestId: string, answer: string | null): boolean {
  const i = pendingDrafts.findIndex((d) => d.requestId === requestId);
  if (i >= 0) pendingDrafts.splice(i, 1);
  let sent = true;
  if (answer === null) link?.sendDraftCancelled(requestId);
  else sent = link?.sendDraftResult({ requestId, answer } satisfies DraftResult) ?? false;
  emit();
  return sent;
}
