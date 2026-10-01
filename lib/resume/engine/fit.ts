import { renderResumeHtml, PAGE_CSS } from "./html";
import { PAGE } from "./layout";
import type { ResumeDoc, ResumeHeader } from "./schema";
import { FIT_LIMIT } from "./trim";

// Browser-only: measures the HTML rendering of the resume against one US Letter page. The HTML
// uses the same font, sizes, margins, spacing and line height as the .docx (html.ts documents the
// Word-parity details), so this is a close proxy for Word's own layout. FIT_LIMIT (trim.ts) leaves
// a small safety margin for the differences that remain.

let host: HTMLDivElement | null = null;

function measureHost(): HTMLDivElement {
  if (host && document.body.contains(host)) return host;
  host = document.createElement("div");
  host.setAttribute("aria-hidden", "true");
  host.style.cssText = "position:absolute;left:-10000px;top:0;visibility:hidden;pointer-events:none";
  const style = document.createElement("style");
  style.textContent = PAGE_CSS;
  host.appendChild(style);
  document.body.appendChild(host);
  return host;
}

/** Usable page height in CSS px (inside the top and bottom margins, at 96 px per inch). */
const USABLE_PX = (PAGE.heightIn - 2 * PAGE.marginYIn) * 96;

/** Content height as a share of the usable page height (1.0 = exactly reaches the bottom margin). */
export function pageFill(header: ResumeHeader, doc: ResumeDoc): number {
  const h = measureHost();
  const wrap = document.createElement("div");
  wrap.innerHTML = renderResumeHtml(header, doc);
  const page = wrap.firstElementChild as HTMLElement;
  page.style.minHeight = "0";
  page.style.paddingTop = "0";
  page.style.paddingBottom = "0";
  h.appendChild(wrap);
  const heightPx = page.getBoundingClientRect().height;
  h.removeChild(wrap);
  return heightPx / USABLE_PX;
}

export function fitsOnePage(header: ResumeHeader, doc: ResumeDoc): boolean {
  return pageFill(header, doc) <= FIT_LIMIT;
}
