// Pure DOM-reading helpers: given a form field, work out what a human would call it. No filling
// logic here — that's fillEngine.ts, kept separate so this half is easy to unit test with jsdom.

export type FillableField = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;

const SKIP_INPUT_TYPES = new Set(["submit", "button", "reset", "hidden", "image", "file"]);

export function isFillable(el: Element): el is FillableField {
  if (el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) return !el.disabled;
  if (el instanceof HTMLInputElement) return !el.disabled && !SKIP_INPUT_TYPES.has(el.type);
  return false;
}

export function findFormFields(root: ParentNode): FillableField[] {
  return [...root.querySelectorAll<FillableField>("input, select, textarea")].filter(isFillable);
}

export function findFileInputs(root: ParentNode): HTMLInputElement[] {
  return [...root.querySelectorAll<HTMLInputElement>('input[type="file"]')];
}

function humanize(name: string): string {
  return name
    .replace(/[_-]+/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\[\d+\]|\[\]/g, "")
    .toLowerCase()
    .trim();
}

function textOf(el: Element | null): string {
  return (el?.textContent ?? "").replace(/\s+/g, " ").trim();
}

/** Best-effort human-readable label for a form field, checking the usual sources in order of
 * reliability. Returns "" if nothing usable is found (the field is then left alone). */
export function getFieldLabel(field: FillableField): string {
  const aria = field.getAttribute("aria-label");
  if (aria?.trim()) return aria.trim();

  const labelledBy = field.getAttribute("aria-labelledby");
  if (labelledBy) {
    const text = labelledBy
      .split(/\s+/)
      .map((id) => textOf(field.ownerDocument.getElementById(id)))
      .filter(Boolean)
      .join(" ");
    if (text) return text;
  }

  if (field.id) {
    // Avoid CSS.escape (not implemented in some test/runtime environments) by matching the
    // attribute directly instead of building a CSS selector string.
    const forLabel = [...field.ownerDocument.querySelectorAll("label")].find((l) => l.getAttribute("for") === field.id);
    const text = textOf(forLabel ?? null);
    if (text) return text;
  }

  const wrapping = field.closest("label");
  if (wrapping) {
    // Exclude the field's own value/placeholder text from leaking into the label.
    const clone = wrapping.cloneNode(true) as HTMLElement;
    clone.querySelectorAll("input, select, textarea").forEach((n) => n.remove());
    const text = textOf(clone);
    if (text) return text;
  }

  const placeholder = "placeholder" in field ? field.getAttribute("placeholder") : null;
  if (placeholder?.trim()) return placeholder.trim();

  if (field.name) return humanize(field.name);
  if (field.id) return humanize(field.id);

  return "";
}
