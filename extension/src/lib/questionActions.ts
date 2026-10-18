// The buttons under an open question in the checklist: use a saved answer, draft one in the app,
// and save what she typed into her answer bank. Every one is her click; nothing is written into
// the form or saved by itself. Legal and identity questions get no buttons at all.
import { setNativeValue } from "./dom";
import { isLegalSounding } from "./guards";
import type { FillOutcome } from "../types";

export interface QuestionDeps {
  requestDraft(question: string): Promise<{ ok: boolean; error?: string }>;
  saveAnswer(question: string, answer: string): Promise<{ ok: boolean; queued?: boolean; error?: string; duplicate?: boolean }>;
}

type TextField = HTMLInputElement | HTMLTextAreaElement;

function btn(text: string, className = "jc-small"): HTMLButtonElement {
  const b = document.createElement("button");
  b.type = "button";
  b.className = className;
  b.textContent = text;
  return b;
}

function note(text: string): HTMLElement {
  const n = document.createElement("span");
  n.className = "jc-row-reason";
  n.textContent = text;
  return n;
}

/** Fields for open questions by label, so an approved draft can find its place again. */
export const questionFields = new Map<string, TextField>();

export function isOpenQuestion(o: FillOutcome): boolean {
  if (!o.el || o.legal || isLegalSounding(o.label)) return false;
  if (!(o.el instanceof HTMLTextAreaElement || o.el instanceof HTMLInputElement)) return false;
  return o.status === "skipped-needs-review" && (!!o.suggestion || o.reason?.includes("Free-text") === true);
}

export function addQuestionActions(row: HTMLElement, o: FillOutcome, deps: QuestionDeps): void {
  if (!isOpenQuestion(o)) return;
  const field = o.el as TextField;
  questionFields.set(o.label, field);

  if (o.suggestion) {
    const box = document.createElement("div");
    box.className = "jc-suggest";
    const preview = document.createElement("div");
    preview.className = "jc-row-reason";
    preview.textContent = `Saved for "${o.suggestion.question}": ${o.suggestion.answer.slice(0, 160)}${o.suggestion.answer.length > 160 ? "..." : ""}`;
    const use = btn("Use this saved answer");
    use.addEventListener("click", () => {
      if (field.value.trim() && !field.value.startsWith(o.suggestion!.answer.slice(0, 20))) {
        use.textContent = "The box already has text. Clear it first.";
        return;
      }
      setNativeValue(field, o.suggestion!.answer);
      use.textContent = "Inserted. Check it names the right company.";
      use.disabled = true;
    });
    box.append(preview, use);
    row.appendChild(box);
  }

  const draft = btn("Draft with AI in Job Copilot", "jc-draft");
  draft.addEventListener("click", async () => {
    draft.disabled = true;
    draft.textContent = "Opening Job Copilot...";
    const res = await deps.requestDraft(o.label);
    if (res.ok) draft.textContent = "Waiting for your approval in Job Copilot";
    else {
      draft.disabled = false;
      draft.textContent = "Draft with AI in Job Copilot";
      row.appendChild(note(res.error ?? "Couldn't reach Job Copilot."));
    }
  });
  row.appendChild(draft);

  const save = btn("Save my answer to the answer bank");
  save.addEventListener("click", async () => {
    const answer = field.value.trim();
    if (!answer) {
      save.textContent = "Type your answer into the form first, then click this.";
      return;
    }
    save.disabled = true;
    const res = await deps.saveAnswer(o.label, answer);
    if (!res.ok) {
      save.disabled = false;
      save.textContent = res.error ?? "Couldn't save. Try again.";
    } else if (res.duplicate) save.textContent = "Already in your answer bank.";
    else save.textContent = res.queued ? "Will be saved when Job Copilot is open." : "Saved to your answer bank.";
  });
  row.appendChild(save);
}

/** An approved draft: shown next to its question, inserted only on her click. */
export function showApprovedDraft(row: HTMLElement, fieldKey: string, answer: string): void {
  row.querySelector(".jc-draft")?.remove();
  const textarea = document.createElement("textarea");
  textarea.className = "jc-draft-text";
  textarea.value = answer;
  const insert = btn("Insert into the form", "jc-action");
  insert.addEventListener("click", () => {
    const field = questionFields.get(fieldKey);
    if (!field || !field.isConnected) {
      insert.textContent = "Couldn't find that question on the page. Copy the text instead.";
      return;
    }
    setNativeValue(field, textarea.value);
    insert.textContent = "Inserted";
    insert.disabled = true;
  });
  row.append(textarea, insert);
}
