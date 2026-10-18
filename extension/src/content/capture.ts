// Runs on known ATS pages (manifest.json) and on sites she turned on with "Use on this site".
// Injects one small floating button; everything it does is behind an explicit click. Uses a shadow
// root so the host page's CSS can't mangle (or be mangled by) this UI.
//
// It never clicks a button on the page (so it can't submit anything), never fills a password field
// or an account page, and never runs on LinkedIn, Indeed or Jobright.
import { pickAdapter } from "../lib/adapters";
import { fillForm } from "../lib/fillEngine";
import { isBlockedHost } from "../lib/hosts";
import { getFieldLabel } from "../lib/matching";
import { extractVisibleText } from "../lib/pageText";
import type { ContextReply, SimpleReply, TabMessage } from "../messages";
import type { FillOutcome } from "../types";

const HOST_ID = "job-copilot-host";

function shouldRun(): boolean {
  if (document.getElementById(HOST_ID)) return false;
  if (isBlockedHost(location.hostname)) return false;
  // In a frame only for a known ATS form embedded in a company's career page.
  if (window.top !== window && pickAdapter(location).name === "generic") return false;
  return true;
}

if (shouldRun()) init();

interface Ui {
  panel: HTMLElement;
  shadow: ShadowRoot;
}

let ui: Ui;
let lastContext: ContextReply | null = null;

function init(): void {
  const host = document.createElement("div");
  host.id = HOST_ID;
  host.style.all = "initial";
  document.documentElement.appendChild(host);
  const shadow = host.attachShadow({ mode: "closed" });

  const style = document.createElement("style");
  style.textContent = CSS;
  shadow.appendChild(style);

  const toggle = el("button", "jc-toggle", "Job Copilot");
  const panel = el("div", "jc-panel jc-hidden");
  shadow.appendChild(toggle);
  shadow.appendChild(panel);
  ui = { panel, shadow };

  toggle.addEventListener("click", () => {
    panel.classList.toggle("jc-hidden");
    if (!panel.classList.contains("jc-hidden")) renderMenu();
  });

  chrome.runtime.onMessage.addListener((msg: TabMessage) => {
    if (msg.type === "DRAFT_READY") showDraft(msg.fieldKey, msg.answer);
    if (msg.type === "DRAFT_CANCELLED") setStatus("The draft was cancelled in Job Copilot.");
  });
}

function send<T>(message: unknown): Promise<T> {
  return chrome.runtime.sendMessage(message) as Promise<T>;
}

async function loadContext(): Promise<ContextReply> {
  const adapter = pickAdapter(location);
  const page = adapter.pageJobInfo?.(document) ?? { company: "", role: "" };
  lastContext = await send<ContextReply>({ type: "GET_CONTEXT", url: location.href, page });
  return lastContext;
}

function renderMenu(): void {
  const { panel } = ui;
  panel.innerHTML = "";
  panel.appendChild(el("div", "jc-title", "Job Copilot"));

  const fillBtn = el("button", "jc-action jc-primary", "Fill this application");
  fillBtn.addEventListener("click", () => void runFillApplication());
  panel.appendChild(fillBtn);

  const scoreBtn = el("button", "jc-action", "Check this job in Job Copilot");
  scoreBtn.addEventListener("click", () => void runScoreThisJob());
  panel.appendChild(scoreBtn);

  panel.appendChild(el("div", "jc-hint", "Nothing is ever submitted for you. Review everything, then click Submit yourself."));
}

async function runScoreThisJob(): Promise<void> {
  setStatus("Sending this page to Job Copilot...");
  const text = extractVisibleText(document.body);
  if (text.length < 200) {
    setStatus("Couldn't find much text on this page. Copy the job description and paste it into Job Copilot instead.");
    return;
  }
  const res = await send<SimpleReply>({ type: "CAPTURE_JOB", text, url: location.href });
  setStatus(res.ok ? "Opened in Job Copilot." : res.error);
}

async function runFillApplication(): Promise<void> {
  setStatus("Filling in what it can...");
  const ctx = await loadContext();
  if (!ctx.paired) {
    setStatus("Not connected yet. In Job Copilot, open Settings > Chrome extension and click Connect.");
    return;
  }
  if (!ctx.data.profile.fullName && ctx.data.answerBank.length === 0) {
    setStatus("No profile synced yet. Open Job Copilot once so it can send your Profile.");
    return;
  }
  const adapter = pickAdapter(location);
  const root = adapter.findFormRoot(document) ?? document.body;
  const outcomes = fillForm(root, ctx.data.profile);
  renderChecklist(outcomes);
}

function renderChecklist(outcomes: FillOutcome[]): void {
  const { panel } = ui;
  panel.innerHTML = "";
  const filled = outcomes.filter((o) => o.status === "filled").length;
  panel.appendChild(el("div", "jc-title", `Filled ${filled}, needs you ${outcomes.length - filled}`));

  for (const o of outcomes) {
    const row = el("div", `jc-row jc-${o.status}`);
    row.appendChild(el("span", "jc-row-label", o.label));
    if (o.status !== "filled" || o.reason) row.appendChild(el("span", "jc-row-reason", o.reason ?? statusLabel(o.status)));
    if (o.status === "skipped-needs-review" && o.reason?.includes("Free-text")) {
      const draftBtn = el("button", "jc-draft", "Draft with AI in Job Copilot");
      draftBtn.addEventListener("click", () => void requestDraft(row, o.label, draftBtn as HTMLButtonElement));
      row.appendChild(draftBtn);
    }
    row.dataset.fieldKey = o.label;
    panel.appendChild(row);
  }

  const back = el("button", "jc-action", "Back");
  back.addEventListener("click", () => renderMenu());
  panel.appendChild(back);
}

function statusLabel(status: FillOutcome["status"]): string {
  switch (status) {
    case "skipped-no-data":
      return "No saved answer";
    case "skipped-needs-review":
      return "Needs your review";
    case "skipped-unmatched":
      return "Not recognized";
    default:
      return "";
  }
}

/** The question and the page go to the app, which drafts with its own AI settings; the answer
 * comes back only after she approves it there (see showDraft). */
async function requestDraft(row: HTMLElement, label: string, btn: HTMLButtonElement): Promise<void> {
  btn.disabled = true;
  btn.textContent = "Opening Job Copilot...";
  const res = await send<SimpleReply>({
    type: "DRAFT_REQUEST",
    question: label,
    jobText: extractVisibleText(document.body),
    pageUrl: location.href,
    jobId: lastContext?.match?.job.id ?? null,
    fieldKey: label,
  });
  if (res.ok) {
    btn.textContent = "Waiting for your approval in Job Copilot";
  } else {
    btn.disabled = false;
    btn.textContent = "Draft with AI in Job Copilot";
    row.appendChild(el("span", "jc-row-reason", res.error));
  }
}

/** An approved draft is shown next to its question. It goes into the form only on her click. */
function showDraft(fieldKey: string, answer: string): void {
  ui.panel.classList.remove("jc-hidden");
  const row = [...ui.panel.querySelectorAll<HTMLElement>(".jc-row")].find((r) => r.dataset.fieldKey === fieldKey) ?? ui.panel;
  row.querySelector(".jc-draft")?.remove();
  const textarea = el("textarea", "jc-draft-text") as HTMLTextAreaElement;
  textarea.value = answer;
  const insertBtn = el("button", "jc-action", "Insert into the form") as HTMLButtonElement;
  insertBtn.addEventListener("click", () => {
    const field = findTextareaByLabel(fieldKey);
    if (!field) {
      insertBtn.textContent = "Couldn't find that question on the page. Copy the text instead.";
      return;
    }
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")?.set;
    setter?.call(field, textarea.value);
    field.dispatchEvent(new Event("input", { bubbles: true }));
    field.dispatchEvent(new Event("change", { bubbles: true }));
    insertBtn.textContent = "Inserted";
    insertBtn.disabled = true;
  });
  row.appendChild(textarea);
  row.appendChild(insertBtn);
}

function findTextareaByLabel(label: string): HTMLTextAreaElement | null {
  for (const ta of document.querySelectorAll("textarea")) {
    if (getFieldLabel(ta) === label) return ta;
  }
  return null;
}

function setStatus(text: string): void {
  let status = ui.panel.querySelector(".jc-status");
  if (!status) {
    status = el("div", "jc-status");
    ui.panel.appendChild(status);
  }
  status.textContent = text;
}

function el(tag: string, className: string, text?: string): HTMLElement {
  const node = document.createElement(tag);
  node.className = className;
  if (text) node.textContent = text;
  return node;
}

const CSS = `
  .jc-toggle {
    position: fixed; bottom: 20px; right: 20px; z-index: 2147483647;
    background: #7b3fe4; color: white; border: none; border-radius: 999px;
    padding: 10px 16px; font: 600 13px system-ui, sans-serif; cursor: pointer;
    box-shadow: 0 2px 8px rgba(0,0,0,0.25);
  }
  .jc-panel {
    position: fixed; bottom: 68px; right: 20px; z-index: 2147483647;
    width: 330px; max-height: 70vh; overflow-y: auto;
    background: white; color: #1d1d1f; border-radius: 16px;
    box-shadow: 0 4px 24px rgba(0,0,0,0.25); padding: 14px;
    font: 13px system-ui, sans-serif;
  }
  .jc-hidden { display: none; }
  .jc-title { font-weight: 700; margin-bottom: 10px; }
  .jc-action {
    display: block; width: 100%; text-align: left; margin-bottom: 8px;
    background: #f5f5f7; border: 1px solid #e5e5ea; border-radius: 10px;
    padding: 8px 10px; cursor: pointer; font: 13px system-ui, sans-serif; color: #1d1d1f;
  }
  .jc-action:hover { background: #ececf0; }
  .jc-primary { background: #7b3fe4; color: white; border-color: #7b3fe4; }
  .jc-primary:hover { background: #6a32cc; }
  .jc-hint { color: #6e6e73; font-size: 11px; margin-top: 8px; }
  .jc-note { background: #f5f0ff; color: #4b2391; border-radius: 10px; padding: 8px 10px; margin-bottom: 8px; font-size: 12px; }
  .jc-status { margin-top: 8px; color: #3a3a3c; }
  .jc-row { border-top: 1px solid #eee; padding: 6px 0; }
  .jc-row-label { display: block; font-weight: 600; }
  .jc-row-reason { display: block; color: #a05a00; font-size: 12px; }
  .jc-filled .jc-row-reason { color: #6e6e73; }
  .jc-filled .jc-row-label::before { content: "\\2713  "; color: #1f8a3b; }
  .jc-draft, .jc-small { margin-top: 4px; background: #f5f0ff; border: 1px solid #dccbfa; border-radius: 8px; padding: 4px 8px; cursor: pointer; font: 12px system-ui, sans-serif; color: #4b2391; }
  .jc-draft-text { width: 100%; margin-top: 6px; min-height: 70px; box-sizing: border-box; font: 12px system-ui, sans-serif; }
  select.jc-select { width: 100%; margin: 4px 0 8px; font: 12px system-ui, sans-serif; }
`;
