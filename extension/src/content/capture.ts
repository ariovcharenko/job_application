// Runs on known ATS pages (manifest.json) and on sites she turned on with "Use on this site".
// Injects one small floating button; everything it does is behind an explicit click. Uses a shadow
// root so the host page's CSS can't mangle (or be mangled by) this UI.
//
// It never clicks a button on the page (so it can't submit anything), never fills a password field
// or an account page, and never runs on LinkedIn, Indeed or Jobright.
import { pickAdapter } from "../lib/adapters";
import { fillForm } from "../lib/fillEngine";
import { ACCOUNT_PAGE_MESSAGE, isAccountPage } from "../lib/guards";
import { isBlockedHost } from "../lib/hosts";
import { preflight, summarizePreflight } from "../lib/preflight";
import { watchForNewFields, type FieldWatcher } from "../lib/watch";
import { addQuestionActions, showApprovedDraft } from "../lib/questionActions";
import { extractVisibleText } from "../lib/pageText";
import { uploadResumeForJob, type ResumeOutcome } from "../lib/resumeFlow";
import type { ContextReply, ResumeReply, SimpleReply, TabMessage } from "../messages";
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
  const page = adapter.pageJobInfo?.(document, location.hostname) ?? { company: "", role: "" };
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

  const pre = el("div", "jc-note", "Checking what this form asks for...");
  panel.appendChild(pre);
  void renderPreflight(pre);

  panel.appendChild(el("div", "jc-hint", "Nothing is ever submitted for you. Review everything, then click Submit yourself."));
}

/** "Before you start": what the form asks for beyond the Profile, from the page alone. */
async function renderPreflight(box: HTMLElement): Promise<void> {
  try {
    const ctx = await loadContext();
    if (isAccountPage(document, location)) {
      box.textContent = "Account or sign-in page. Job Copilot won't fill it.";
      return;
    }
    const adapter = pickAdapter(location);
    const items = preflight(adapter.findFormRoot(document) ?? document.body, ctx.data.profile, ctx.data.answerBank, adapter.findResumeInput(document));
    const lines = summarizePreflight(items);
    const job = ctx.match ? `Saved job: ${ctx.match.job.company}, ${ctx.match.job.role}.` : "Not one of your saved jobs yet.";
    box.textContent = "";
    box.appendChild(el("div", "", job));
    if (lines.length) {
      box.appendChild(el("div", "jc-row-label", "Also asks for:"));
      for (const l of lines) box.appendChild(el("div", "", `\u2022 ${l}`));
    } else box.appendChild(el("div", "", "Nothing beyond what your Profile covers."));
  } catch {
    box.textContent = "";
  }
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

let watcher: FieldWatcher | null = null;

async function runFillApplication(onlyEmpty = false): Promise<void> {
  if (isAccountPage(document, location)) {
    setStatus(ACCOUNT_PAGE_MESSAGE);
    return;
  }
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
  const outcomes = fillForm(root, ctx.data.profile, { experiences: ctx.data.experiences, answers: ctx.data.answerBank, onlyEmpty });
  // The resume: this job's tailored one when the page matches a saved job. Asked for only now.
  setStatus("Getting your resume from Job Copilot...");
  const resume = await uploadResumeForJob(adapter.findResumeInput(document), ctx.match, {
    requestResume: (jobId) => send<ResumeReply>({ type: "GET_RESUME", jobId }),
  });
  renderChecklist(outcomes, resume, ctx);
  // A later step or a block she adds shows up as new fields: offer one click, never fill by itself.
  watcher?.stop();
  watcher = watchForNewFields(document.body, (count) => {
    if (isAccountPage(document, location)) return;
    offerNewFields(count);
  });
}

function offerNewFields(count: number): void {
  ui.panel.classList.remove("jc-hidden");
  ui.panel.querySelector(".jc-new")?.remove();
  const btn = el("button", "jc-action jc-primary jc-new", `${count} new field${count === 1 ? "" : "s"} appeared. Fill them`);
  btn.addEventListener("click", () => void runFillApplication(true));
  ui.panel.insertBefore(btn, ui.panel.firstChild);
}

function renderChecklist(outcomes: FillOutcome[], resume: ResumeOutcome, ctx: ContextReply): void {
  const { panel } = ui;
  panel.innerHTML = "";
  const filled = outcomes.filter((o) => o.status === "filled").length;
  panel.appendChild(el("div", "jc-title", `Filled ${filled}, needs you ${outcomes.length - filled}`));
  panel.appendChild(el("div", "jc-note", ctx.match ? `Saved job: ${ctx.match.job.company}, ${ctx.match.job.role}.` : "This page isn't one of your saved jobs, so nothing is tied to a job."));
  const resumeRow = el("div", `jc-row ${resume.status === "uploaded" ? "jc-filled" : "jc-skipped"}`);
  resumeRow.appendChild(el("span", "jc-row-label", "Resume"));
  resumeRow.appendChild(el("span", "jc-row-reason", resume.note));
  panel.appendChild(resumeRow);

  for (const o of outcomes) {
    const row = el("div", `jc-row jc-${o.status}`);
    row.appendChild(el("span", "jc-row-label", o.label));
    if (o.status !== "filled" || o.reason) row.appendChild(el("span", "jc-row-reason", o.reason ?? statusLabel(o.status)));
    addQuestionActions(row, o, {
      requestDraft: (question) => requestDraft(question),
      saveAnswer: (question, answer) => send<SimpleReply>({ type: "SAVE_ANSWER", question, answer }),
    });
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
async function requestDraft(question: string): Promise<SimpleReply> {
  return send<SimpleReply>({
    type: "DRAFT_REQUEST",
    question,
    jobText: extractVisibleText(document.body),
    pageUrl: location.href,
    jobId: lastContext?.match?.job.id ?? null,
    fieldKey: question,
  });
}

function showDraft(fieldKey: string, answer: string): void {
  ui.panel.classList.remove("jc-hidden");
  const row = [...ui.panel.querySelectorAll<HTMLElement>(".jc-row")].find((r) => r.dataset.fieldKey === fieldKey) ?? ui.panel;
  showApprovedDraft(row, fieldKey, answer);
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
  .jc-suggest { margin-top: 4px; }
  .jc-draft-text { width: 100%; margin-top: 6px; min-height: 70px; box-sizing: border-box; font: 12px system-ui, sans-serif; }
  select.jc-select { width: 100%; margin: 4px 0 8px; font: 12px system-ui, sans-serif; }
`;
