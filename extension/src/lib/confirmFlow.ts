// Offers "Mark as applied" once, after the page turns into an application confirmation. It runs on
// load and watches for in-page changes (Ashby and Workday show the message without navigating).
// Offers only: the click that marks the job applied is hers, and nothing here submits anything.
import { isAccountPage } from "./guards";
import { isConfirmationPage } from "./confirmation";
import type { FillSession } from "../messages";

export interface ConfirmDeps {
  doc: Document;
  location: Pick<Location, "pathname">;
  /** "generic" pages are only offered when she clicked Fill in this tab. */
  adapterName: string;
  getSession(): Promise<FillSession | null>;
  /** Tells the background the confirmation was seen, to stop the fill clock. */
  seen(): Promise<unknown>;
  onOffer(session: FillSession | null): void;
  debounceMs?: number;
}

export function watchForConfirmation(deps: ConfirmDeps): { stop(): void } {
  let offered = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let busy = false;

  const check = async () => {
    timer = undefined;
    if (offered || busy) return;
    if (isAccountPage(deps.doc, deps.location) || !isConfirmationPage(deps.doc, deps.location)) return;
    busy = true;
    try {
      const session = await deps.getSession();
      if (!session && deps.adapterName === "generic") return;
      offered = true;
      await deps.seen();
      deps.onOffer(session);
      mo.disconnect();
    } finally {
      busy = false;
    }
  };
  const schedule = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = setTimeout(() => void check(), deps.debounceMs ?? 1000);
  };
  const mo = new MutationObserver(schedule);
  mo.observe(deps.doc.body, { childList: true, subtree: true, characterData: true });
  schedule();
  return {
    stop() {
      mo.disconnect();
      if (timer !== undefined) clearTimeout(timer);
    },
  };
}
