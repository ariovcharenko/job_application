// Makes HTML rendered from a file she uploaded (docx-preview drawing her own Word resume) inert.
// A .docx can carry any hyperlink target, including javascript:. With the CSP's 'unsafe-inline'
// scripts, clicking such a link would run code on this origin, which can read the API key from
// IndexedDB. So after rendering, every link that isn't http(s), mailto or an in-document #anchor
// loses its href, event-handler attributes are removed, and elements that can run or load
// things (script, iframe, object, embed, form, base, meta, link) are dropped.

/** Removes the characters browsers ignore inside a URL scheme ("java\tscript:"), then trims. */
const squash = (s: string) => s.replace(/[\u0000- \u007f-\u009f]/g, "");

/** The href to keep for a link in rendered user content, or null to drop it. */
export function safeDocumentHref(href: string | null | undefined): string | null {
  if (href == null) return null;
  const s = squash(href);
  if (!s) return null;
  if (s.startsWith("#")) return href.trim();
  if (/^(https?:\/\/|mailto:)/i.test(s)) return href.trim();
  return null;
}

/** A src to keep for an image in rendered user content: blob: and data:image only (docx-preview's own). */
export function safeDocumentSrc(src: string | null | undefined): string | null {
  if (src == null) return null;
  const s = squash(src);
  return /^(blob:|data:image\/(png|jpe?g|gif|webp|bmp);)/i.test(s) ? src.trim() : null;
}

const DROP_ELEMENTS = ["script", "iframe", "frame", "object", "embed", "form", "base", "meta", "link", "portal"];
const URL_ATTRS = new Set(["href", "xlink:href"]);
const SRC_ATTRS = new Set(["src"]);
const DROP_ATTRS = new Set(["srcdoc", "action", "formaction", "background", "poster", "srcset", "ping"]);

/** The parts of the DOM this uses (so it can be tested without a browser). */
export interface MinimalElement {
  tagName: string;
  attributes: ArrayLike<{ name: string; value: string }>;
  getAttribute(name: string): string | null;
  setAttribute(name: string, value: string): void;
  removeAttribute(name: string): void;
  remove(): void;
}
export interface MinimalRoot {
  querySelectorAll(selector: string): ArrayLike<MinimalElement>;
}

/** Neutralizes rendered user content in place. Returns how many things it changed (for tests). */
export function neutralizeRenderedDocument(root: MinimalRoot): number {
  let changed = 0;
  for (const el of Array.from(root.querySelectorAll(DROP_ELEMENTS.join(",")))) {
    el.remove();
    changed++;
  }
  for (const el of Array.from(root.querySelectorAll("*"))) {
    for (const { name, value } of Array.from(el.attributes)) {
      const n = name.toLowerCase();
      if (n.startsWith("on") || DROP_ATTRS.has(n)) {
        el.removeAttribute(name);
        changed++;
      } else if (URL_ATTRS.has(n)) {
        const safe = safeDocumentHref(value);
        if (safe === null) {
          el.removeAttribute(name);
          changed++;
        } else if (el.tagName.toLowerCase() === "a" && !safe.startsWith("#")) {
          el.setAttribute("target", "_blank");
          el.setAttribute("rel", "noopener noreferrer");
        }
      } else if (SRC_ATTRS.has(n) && safeDocumentSrc(value) === null) {
        el.removeAttribute(name);
        changed++;
      }
    }
  }
  return changed;
}
