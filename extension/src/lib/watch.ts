// Notices when new form fields appear after she clicked Fill: the next step of a multi-step
// application (Workday), or a block she added with "Add". It only reports a count, so the panel
// can offer a one-click "Fill the new fields". It never fills anything on its own.
import { findFormFields } from "./matching";

export interface FieldWatcher {
  stop(): void;
}

export function watchForNewFields(
  root: Node,
  onNew: (count: number) => void,
  opts: { debounceMs?: number; window?: Pick<Window, "setTimeout" | "clearTimeout"> } = {},
): FieldWatcher {
  const seen = new WeakSet<Element>(findFormFields(document));
  const win = opts.window ?? window;
  let timer: number | undefined;
  const check = () => {
    timer = undefined;
    const fresh = findFormFields(document).filter((f) => !seen.has(f));
    for (const f of fresh) seen.add(f);
    if (fresh.length > 0) onNew(fresh.length);
  };
  const mo = new MutationObserver((records) => {
    if (!records.some((r) => r.addedNodes.length > 0)) return;
    if (timer !== undefined) win.clearTimeout(timer);
    timer = win.setTimeout(check, opts.debounceMs ?? 500);
  });
  mo.observe(root, { childList: true, subtree: true });
  return {
    stop() {
      mo.disconnect();
      if (timer !== undefined) win.clearTimeout(timer);
    },
  };
}
