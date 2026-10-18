// Recognizing the page an ATS shows AFTER she submitted ("Thanks for applying"), so the panel can
// offer "Mark as applied in Job Copilot". It only reads the page: it never submits anything, and
// it does nothing until she clicks the offer. Deliberately strict, since a wrong guess would offer
// to mark a job applied that she hasn't applied to: wording must say the application was
// received/submitted, and no text boxes may be left to fill (so "Thank you for your interest" on a
// job description page, or a form with an inline message, don't count).

const DONE_TEXT =
  /(thanks?|thank you) (you )?for (applying|submitting)|(application|resume) (was |has been |is )?(successfully )?(submitted|received|sent)|(we('| ha)ve|we've) received your (application|submission)|your application (is|has been) (in|submitted|received|on its way)|application complete/i;

const DONE_PATH = /\/(thanks?|confirmation|confirmed|submitted|application-submitted|success|complete)(\/|$|\?)/i;

const visible = (el: Element) => !(el as HTMLElement).hidden && !el.closest("[hidden], [aria-hidden='true']");

/** The first `max` characters of text that isn't inside a hidden element or a script/style. */
function visibleText(root: Element, max: number): string {
  const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let out = "";
  for (let n = walker.nextNode(); n && out.length < max; n = walker.nextNode()) {
    const parent = n.parentElement;
    if (!parent || !visible(parent) || /^(script|style|noscript)$/i.test(parent.tagName)) continue;
    out += ` ${n.textContent ?? ""}`;
  }
  return out.replace(/\s+/g, " ").trim().slice(0, max);
}

/** Text in the places a confirmation message lives (headings, alerts, the start of the main area). */
function headlineText(doc: Document): string {
  const parts: string[] = [];
  for (const el of doc.querySelectorAll("h1, h2, h3, [role='alert'], [role='status'], [data-automation-id*='submitted' i], [data-automation-id*='confirmation' i]")) {
    if (visible(el)) parts.push(el.textContent ?? "");
  }
  const main = doc.querySelector("main, [role='main'], #main, #content") ?? doc.body;
  parts.push(visibleText(main, 600));
  return parts.join(" \n ").replace(/\s+/g, " ");
}

function openTextBoxes(doc: Document): number {
  return [...doc.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("textarea, input")].filter((el) => {
    if (el instanceof HTMLInputElement && ["hidden", "submit", "button", "checkbox", "radio", "file", "image", "reset"].includes(el.type)) return false;
    return !el.disabled && !el.readOnly && visible(el);
  }).length;
}

export function isConfirmationPage(doc: Document, location: Pick<Location, "pathname"> = { pathname: "" }): boolean {
  if (openTextBoxes(doc) > 0) return false;
  const text = headlineText(doc);
  if (DONE_TEXT.test(text)) return true;
  // A confirmation-looking address alone is not enough (a /success page can be anything): the
  // page must also be short and have a heading.
  return DONE_PATH.test(location.pathname) && /thank|submitted|received|confirm/i.test(text);
}
