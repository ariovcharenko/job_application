const MAX_CAPTURE_CHARS = 20000;

/** The visible text of the page, for "Score this job" — trimmed and capped so a huge page (or
 * one with hidden boilerplate) doesn't balloon the AI call downstream. */
export function extractVisibleText(root: HTMLElement): string {
  const text = (root.innerText ?? root.textContent ?? "").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  return text.slice(0, MAX_CAPTURE_CHARS);
}
