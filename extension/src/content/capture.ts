// Runs on every page (see manifest.json). Injects one small floating button; everything it does
// is behind an explicit click — nothing scans or fills a page on its own. Uses a shadow root so
// the host page's CSS can't mangle (or be mangled by) this UI.
import { pickAdapter } from "../lib/adapters";
import { draftFreeTextAnswer } from "../lib/anthropic";
import { fillForm } from "../lib/fillEngine";
import { getFieldLabel } from "../lib/matching";
import { extractVisibleText } from "../lib/pageText";
import { base64ToFile, setFileInput } from "../lib/resumeUpload";
import { getAppOrigin, getSyncedData, setPendingCapture } from "../lib/storage";
import type { FillOutcome } from "../types";

const HOST_ID = "job-copilot-host";
if (!document.getElementById(HOST_ID) && window.top === window) {
  init();
}

function init(): void {
  const host = document.createElement("div");
  host.id = HOST_ID;
  host.style.all = "initial";
  document.documentElement.appendChild(host);
  const shadow = host.attachShadow({ mode: "open" });

  const style = document.createElement("style");
  style.textContent = CSS;
  shadow.appendChild(style);

  const toggle = el("button", "jc-toggle", "Job Copilot");
  const panel = el("div", "jc-panel jc-hidden");
  shadow.appendChild(toggle);
  shadow.appendChild(panel);

  toggle.addEventListener("click", () => {
    panel.classList.toggle("jc-hidden");
    if (!panel.classList.contains("jc-hidden")) renderMenu(panel);
  });

  renderMenu(panel);
}

function renderMenu(panel: HTMLElement): void {
  panel.innerHTML = "";
  panel.appendChild(el("div", "jc-title", "Job Application Copilot"));

  const scoreBtn = el("button", "jc-action", "Score this job posting");
  scoreBtn.addEventListener("click", () => runScoreThisJob(panel));
  panel.appendChild(scoreBtn);

  const fillBtn = el("button", "jc-action", "Fill this application");
  fillBtn.addEventListener("click", () => runFillApplication(panel));
  panel.appendChild(fillBtn);

  panel.appendChild(el("div", "jc-hint", "Nothing is ever submitted for you — review everything before you click Submit yourself."));
}

async function runScoreThisJob(panel: HTMLElement): Promise<void> {
  setStatus(panel, "Capturing this page's text...");
  const text = extractVisibleText(document.body);
  if (text.length < 200) {
    setStatus(panel, "Couldn't find much text on this page — try selecting the job description manually and pasting it into the app instead.");
    return;
  }
  await setPendingCapture({ text, url: location.href, capturedAt: Date.now() });
  const origin = await getAppOrigin();
  window.open(origin, "_blank");
  setStatus(panel, "Opened the app with this posting ready to score.");
}

async function runFillApplication(panel: HTMLElement): Promise<void> {
  setStatus(panel, "Filling in what it can...");
  const data = await getSyncedData();
  if (!data.profile.fullName && data.answerBank.length === 0) {
    const origin = await getAppOrigin();
    setStatus(panel, `No profile synced yet. Open ${origin} once (with this extension installed) so it can sync your info, then try again.`);
    return;
  }

  const adapter = pickAdapter(window.location);
  const root = adapter.findFormRoot(document) ?? document.body;
  const outcomes = fillForm(root, data.profile);

  const resumeInput = adapter.findResumeInput(document);
  if (resumeInput) {
    if (data.resume) {
      try {
        setFileInput(resumeInput, base64ToFile(data.resume.base64, data.resume.fileName));
        outcomes.unshift({ label: "Resume", status: "filled" });
      } catch (err) {
        outcomes.unshift({ label: "Resume", status: "skipped-needs-review", reason: err instanceof Error ? err.message : String(err) });
      }
    } else {
      outcomes.unshift({ label: "Resume", status: "skipped-no-data", reason: "No tailored resume synced yet — save one from the Tailor dialog in the app." });
    }
  }

  renderChecklist(panel, outcomes, data.anthropicKey);
}

function renderChecklist(panel: HTMLElement, outcomes: FillOutcome[], apiKey: string): void {
  panel.innerHTML = "";
  const filled = outcomes.filter((o) => o.status === "filled").length;
  const needsYou = outcomes.length - filled;
  panel.appendChild(el("div", "jc-title", `Filled ${filled}, needs you ${needsYou}`));

  for (const o of outcomes) {
    const row = el("div", `jc-row jc-${o.status}`);
    row.appendChild(el("span", "jc-row-label", o.label));
    if (o.status !== "filled") {
      row.appendChild(el("span", "jc-row-reason", o.reason ?? statusLabel(o.status)));
    }
    if (o.status === "skipped-needs-review" && o.reason?.includes("Free-text")) {
      const draftBtn = el("button", "jc-draft", "Draft with AI");
      draftBtn.addEventListener("click", () => draftForLabel(row, o.label, apiKey));
      row.appendChild(draftBtn);
    }
    panel.appendChild(row);
  }

  const back = el("button", "jc-action", "Back");
  back.addEventListener("click", () => renderMenu(panel));
  panel.appendChild(back);
}

function statusLabel(status: FillOutcome["status"]): string {
  switch (status) {
    case "skipped-no-data":
      return "No stored answer";
    case "skipped-needs-review":
      return "Needs your review";
    case "skipped-unmatched":
      return "Not recognized";
    default:
      return "";
  }
}

async function draftForLabel(row: HTMLElement, label: string, apiKey: string): Promise<void> {
  if (!apiKey) {
    row.appendChild(el("span", "jc-row-reason", "Add your Anthropic key in the app's Settings first."));
    return;
  }
  const btn = row.querySelector(".jc-draft") as HTMLButtonElement | null;
  if (btn) btn.textContent = "Drafting...";
  try {
    const context = extractVisibleText(document.body);
    const draft = await draftFreeTextAnswer(apiKey, "claude-sonnet-5", label, context);
    const textarea = el("textarea", "jc-draft-text") as HTMLTextAreaElement;
    textarea.value = draft;
    const insertBtn = el("button", "jc-action", "Insert this into the form") as HTMLButtonElement;
    insertBtn.addEventListener("click", () => {
      const field = findFieldByLabel(label);
      if (field) {
        const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")?.set;
        setter?.call(field, textarea.value);
        field.dispatchEvent(new Event("input", { bubbles: true }));
        field.dispatchEvent(new Event("change", { bubbles: true }));
        insertBtn.textContent = "Inserted ✓";
        insertBtn.disabled = true;
      }
    });
    row.appendChild(textarea);
    row.appendChild(insertBtn);
  } catch (err) {
    row.appendChild(el("span", "jc-row-reason", err instanceof Error ? err.message : String(err)));
  } finally {
    if (btn) btn.remove();
  }
}

function findFieldByLabel(label: string): HTMLTextAreaElement | null {
  // Re-derive each textarea's label the same way fillEngine did, and match it back to the one
  // shown in the checklist — the page hasn't changed shape since, so this is a safe re-lookup.
  for (const ta of document.querySelectorAll("textarea")) {
    if (getFieldLabel(ta) === label) return ta;
  }
  return null;
}

function setStatus(panel: HTMLElement, text: string): void {
  let status = panel.querySelector(".jc-status");
  if (!status) {
    status = el("div", "jc-status");
    panel.appendChild(status);
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
    background: #4f46e5; color: white; border: none; border-radius: 999px;
    padding: 10px 16px; font: 600 13px system-ui, sans-serif; cursor: pointer;
    box-shadow: 0 2px 8px rgba(0,0,0,0.25);
  }
  .jc-panel {
    position: fixed; bottom: 68px; right: 20px; z-index: 2147483647;
    width: 320px; max-height: 70vh; overflow-y: auto;
    background: white; color: #1a1a1a; border-radius: 12px;
    box-shadow: 0 4px 24px rgba(0,0,0,0.25); padding: 14px;
    font: 13px system-ui, sans-serif;
  }
  .jc-hidden { display: none; }
  .jc-title { font-weight: 700; margin-bottom: 10px; }
  .jc-action {
    display: block; width: 100%; text-align: left; margin-bottom: 8px;
    background: #f4f4f5; border: 1px solid #e4e4e7; border-radius: 8px;
    padding: 8px 10px; cursor: pointer; font: 13px system-ui, sans-serif;
  }
  .jc-action:hover { background: #ececee; }
  .jc-hint { color: #71717a; font-size: 11px; margin-top: 8px; }
  .jc-status { margin-top: 8px; color: #3f3f46; }
  .jc-row { border-top: 1px solid #eee; padding: 6px 0; }
  .jc-row-label { display: block; font-weight: 600; }
  .jc-row-reason { display: block; color: #b45309; font-size: 12px; }
  .jc-filled .jc-row-label::before { content: "✓ "; color: #16a34a; }
  .jc-draft { margin-top: 4px; background: #eef2ff; border: 1px solid #c7d2fe; border-radius: 6px; padding: 4px 8px; cursor: pointer; }
  .jc-draft-text { width: 100%; margin-top: 6px; min-height: 70px; box-sizing: border-box; }
`;
