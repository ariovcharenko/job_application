// "Before you start": what this form asks for that Job Copilot can't just fill from your Profile,
// worked out from the page alone (nothing is filled or changed). Written answers say whether a
// saved answer exists, legal questions say whether your Profile has the answer, uploads other than
// the resume are listed. Pure DOM reads plus the same rule tables the fill engine uses.
import { findSavedAnswer } from "./answerMatch";
import { isCombobox, isLegalSounding } from "./guards";
import { cleanLabel } from "./label";
import { findFileInputs, findFormFields, getFieldLabel } from "./matching";
import { matchEeoRule, matchLegalRule, matchTextRule } from "./fillRules";
import type { SyncedAnswer, SyncedProfile } from "../types";

export type PreflightKind = "essay" | "upload" | "choice" | "legal-missing" | "other";

export interface PreflightItem {
  kind: PreflightKind;
  label: string;
  required: boolean;
  /** For an essay: a saved answer that fits. */
  saved?: boolean;
}

const isRequired = (el: Element, label: string) => el.hasAttribute("required") || el.getAttribute("aria-required") === "true" || /\*|✱|required/i.test(label);

function groupLabelOf(radios: HTMLInputElement[]): string {
  const first = radios[0];
  const legend = first.closest("fieldset")?.querySelector("legend")?.textContent;
  const wrapper = first.closest(".application-question, [data-qa*='question' i], [data-field]")?.querySelector(".application-label, [data-qa*='label' i], legend")?.textContent;
  const aria = first.closest('[role="group"], [role="radiogroup"]')?.getAttribute("aria-label");
  return (legend ?? wrapper ?? aria ?? "").replace(/\s+/g, " ").trim();
}

export function preflight(root: ParentNode, profile: SyncedProfile, answers: SyncedAnswer[], resumeInput: HTMLInputElement | null): PreflightItem[] {
  const items: PreflightItem[] = [];

  for (const file of findFileInputs(root)) {
    if (file === resumeInput) continue;
    const raw = getFieldLabel(file) || file.name || "File upload";
    items.push({ kind: "upload", label: cleanLabel(raw), required: isRequired(file, raw) });
  }

  const groups = new Map<string, HTMLInputElement[]>();
  for (const r of root.querySelectorAll<HTMLInputElement>('input[type="radio"]')) {
    if (r.disabled || !r.name) continue;
    groups.set(r.name, [...(groups.get(r.name) ?? []), r]);
  }
  for (const radios of groups.values()) {
    const raw = groupLabelOf(radios);
    const label = cleanLabel(raw);
    if (!label) continue;
    const legal = matchLegalRule(label);
    if (legal) {
      if (!profile[legal.field]) items.push({ kind: "legal-missing", label, required: true });
    } else if (!matchEeoRule(label)) {
      items.push({ kind: "choice", label, required: isRequired(radios[0], raw) });
    }
  }

  for (const f of findFormFields(root)) {
    if (f instanceof HTMLInputElement && (f.type === "radio" || f.type === "checkbox")) continue;
    const raw = getFieldLabel(f);
    const label = cleanLabel(raw);
    if (!label) continue;
    const required = isRequired(f, raw);
    const legal = matchLegalRule(label);
    if (legal) {
      if (!profile[legal.field]) items.push({ kind: "legal-missing", label, required: true });
      continue;
    }
    if (matchEeoRule(label) || matchTextRule(label)) continue;
    if (isLegalSounding(label)) {
      items.push({ kind: "legal-missing", label, required: true });
      continue;
    }
    if (isCombobox(f) || f instanceof HTMLSelectElement) {
      items.push({ kind: "choice", label, required });
    } else if (f instanceof HTMLTextAreaElement) {
      items.push({ kind: "essay", label, required, saved: !!findSavedAnswer(label, answers) });
    } else if (label.length > 25 || label.endsWith("?")) {
      items.push({ kind: "essay", label, required, saved: !!findSavedAnswer(label, answers) });
    } else {
      items.push({ kind: "other", label, required });
    }
  }
  return items;
}

/** One plain sentence for the top of the panel, e.g. "Also asks for: 2 written answers (1 saved)...". */
export function summarizePreflight(items: PreflightItem[]): string[] {
  const lines: string[] = [];
  const essays = items.filter((i) => i.kind === "essay");
  if (essays.length) lines.push(`${essays.length} written answer${essays.length === 1 ? "" : "s"} (${essays.filter((e) => e.saved).length} with a saved answer)`);
  const uploads = items.filter((i) => i.kind === "upload");
  if (uploads.length) lines.push(`${uploads.length} other upload${uploads.length === 1 ? "" : "s"}: ${uploads.map((u) => u.label).join(", ")}`);
  const choices = items.filter((i) => i.kind === "choice");
  if (choices.length) lines.push(`${choices.length} dropdown or choice question${choices.length === 1 ? "" : "s"} to pick yourself`);
  const legal = items.filter((i) => i.kind === "legal-missing");
  if (legal.length) lines.push(`${legal.length} legal question${legal.length === 1 ? "" : "s"} your Profile has no answer for (add it in Settings or answer yourself)`);
  return lines;
}
