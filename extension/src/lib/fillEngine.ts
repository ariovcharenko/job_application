import { setNativeValue } from "./dom";
import { isCombobox } from "./guards";
import { cleanLabel } from "./label";
import { findFormFields, getFieldLabel } from "./matching";
import { fillRepeatedSections } from "./sections";
import { matchEeoRule, matchLegalRule, matchTextRule } from "./fillRules";
import type { FillOutcome, SyncedExperience, SyncedProfile } from "../types";

function setSelectValue(select: HTMLSelectElement, index: number): void {
  select.selectedIndex = index;
  select.dispatchEvent(new Event("input", { bubbles: true }));
  select.dispatchEvent(new Event("change", { bubbles: true }));
}

function checkRadio(radio: HTMLInputElement): void {
  radio.checked = true;
  radio.dispatchEvent(new Event("click", { bubbles: true }));
  radio.dispatchEvent(new Event("input", { bubbles: true }));
  radio.dispatchEvent(new Event("change", { bubbles: true }));
}

const DECLINE_PATTERN = /decline|prefer not|rather not|don'?t wish|do not wish|don'?t want to|do not want to|not specified|choose not|not to (answer|disclose|say)/i;

function tokenize(s: string): string[] {
  return s.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2);
}

/** Finds the option whose text best matches `desired`: exact match, then substring, then — since
 * real ATS option wording rarely matches a short stored value verbatim (e.g. profile says "not a
 * veteran", the option says "I am not a protected veteran of the U.S. military") — every word of
 * `desired` appearing somewhere in the option's text. That last, fuzziest step requires ALL of
 * `desired`'s words to be present (not just a majority) specifically so it can't match an option
 * of opposite meaning that merely shares one word (e.g. "veteran" alone matching either the
 * affirmative or negative option) — a real risk for a short, single-word stored value. When
 * `desired` is empty, matches a "decline to answer" style option instead. Returns null, leaving
 * the field untouched, if nothing confident is found. */
function findBestOptionIndex(options: { text: string }[], desired: string): number | null {
  const norm = (s: string) => s.trim().toLowerCase();
  if (!desired.trim()) {
    const idx = options.findIndex((o) => DECLINE_PATTERN.test(o.text));
    return idx >= 0 ? idx : null;
  }
  const exact = options.findIndex((o) => norm(o.text) === norm(desired));
  if (exact >= 0) return exact;
  const partial = options.findIndex((o) => norm(o.text).includes(norm(desired)) || norm(desired).includes(norm(o.text)));
  if (partial >= 0) return partial;

  const desiredTokens = tokenize(desired);
  if (desiredTokens.length === 0) return null;
  const fuzzy = options.findIndex((o) => {
    const optionTokens = new Set(tokenize(o.text));
    return desiredTokens.every((t) => optionTokens.has(t));
  });
  return fuzzy >= 0 ? fuzzy : null;
}

function fillSelect(select: HTMLSelectElement, desired: string): boolean {
  const options = [...select.options].map((o) => ({ text: o.text }));
  const idx = findBestOptionIndex(options, desired);
  if (idx === null) return false;
  setSelectValue(select, idx);
  return true;
}

function groupRadios(root: ParentNode): Map<string, HTMLInputElement[]> {
  const groups = new Map<string, HTMLInputElement[]>();
  for (const el of root.querySelectorAll<HTMLInputElement>('input[type="radio"]')) {
    if (el.disabled || !el.name) continue;
    const group = groups.get(el.name) ?? [];
    group.push(el);
    groups.set(el.name, group);
  }
  return groups;
}

function textOf(el: Element | null): string {
  return (el?.textContent ?? "").replace(/\s+/g, " ").trim();
}

/** The question text for a radio group: its <fieldset><legend>, or an aria-label/aria-labelledby
 * on the group's common ancestor fieldset/[role=group], else "". */
function getGroupLabel(radios: HTMLInputElement[]): string {
  const first = radios[0];
  const fieldset = first.closest("fieldset");
  if (fieldset) {
    const legend = fieldset.querySelector("legend");
    if (legend) {
      const text = textOf(legend);
      if (text) return text;
    }
    const aria = fieldset.getAttribute("aria-label");
    if (aria?.trim()) return aria.trim();
  }
  const group = first.closest('[role="group"], [role="radiogroup"]');
  const aria = group?.getAttribute("aria-label");
  if (aria?.trim()) return aria.trim();
  const labelledBy = group?.getAttribute("aria-labelledby");
  if (labelledBy) {
    const text = labelledBy
      .split(/\s+/)
      .map((id) => textOf(first.ownerDocument.getElementById(id)))
      .filter(Boolean)
      .join(" ");
    if (text) return text;
  }
  // Lever and similar: the question sits in a labelled wrapper around the options. Only explicit
  // label elements count (never "the text above"), so a wrong guess can't answer another question.
  const wrapper = first.closest(".application-question, [data-qa*='question' i], [data-field]");
  const labelEl = wrapper?.querySelector(".application-label, [data-qa*='label' i], legend");
  const wrapperText = textOf(labelEl ?? null);
  if (wrapperText) return wrapperText;
  return "";
}

function fillYesNoRadioGroup(radios: HTMLInputElement[], desired: "yes" | "no"): boolean {
  const target = radios.find((r) => new RegExp(`^${desired}$`, "i").test(getFieldLabel(r).trim()));
  if (!target) return false;
  checkRadio(target);
  return true;
}

function fillValueRadioGroup(radios: HTMLInputElement[], desired: string): boolean {
  const options = radios.map((r) => ({ text: getFieldLabel(r) }));
  const idx = findBestOptionIndex(options, desired);
  if (idx === null) return false;
  checkRadio(radios[idx]);
  return true;
}

const PLACEHOLDER_OPTION = /^\s*(select|choose|please|--|pick)|^\s*$/i;

/** True when a field already holds something (typed by her or by an earlier Fill). */
export function hasValue(field: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement): boolean {
  if (field instanceof HTMLSelectElement) {
    const opt = field.options[field.selectedIndex];
    return !!opt && field.selectedIndex > 0 ? true : !!opt && field.selectedIndex === 0 && !!opt.value && !PLACEHOLDER_OPTION.test(opt.text);
  }
  return field.value.trim() !== "";
}

function legalValue(profile: SyncedProfile, field: "authorizedToWorkUS" | "requiresSponsorship" | "willingToRelocate"): "yes" | "no" | "" {
  return profile[field];
}

/**
 * Fills every recognizable field in `root` from synced profile data, and returns exactly what it
 * did (or didn't) for the review checklist. Never touches a submit/button control — those aren't
 * fillable fields to begin with (see matching.ts). Legal/identity questions are only ever answered
 * from the matching stored Profile field, via the narrow, explicit patterns in fillRules.ts;
 * anything ambiguous is left blank and reported so she fills it herself.
 */
export function fillForm(root: ParentNode, profile: SyncedProfile, ctx: FillContext = {}): FillOutcome[] {
  const sections = fillRepeatedSections(root, profile, ctx.experiences ?? []);
  const outcomes: FillOutcome[] = [...sections.outcomes];
  const handledNames = new Set<string>();

  // Radio groups first, since findFormFields would otherwise treat each option as its own field.
  for (const [name, radios] of groupRadios(root)) {
    handledNames.add(name);
    if (radios.every((r) => sections.handled.has(r))) continue;
    if (ctx.onlyEmpty && radios.some((r) => r.checked)) continue;
    const label = cleanLabel(getGroupLabel(radios));
    if (!label) {
      outcomes.push({ label: `Unlabeled question (${radios.length} options)`, status: "skipped-needs-review", reason: "Couldn't find this question's text." });
      continue;
    }
    const legal = matchLegalRule(label);
    if (legal) {
      const value = legalValue(profile, legal.field);
      if (!value) {
        outcomes.push({ label, status: "skipped-no-data", reason: "No stored answer for this legal question — left for you." });
        continue;
      }
      outcomes.push(fillYesNoRadioGroup(radios, value) ? { label, status: "filled" } : { label, status: "skipped-needs-review", reason: "Couldn't find a matching Yes/No option." });
      continue;
    }
    const eeo = matchEeoRule(label);
    if (eeo) {
      outcomes.push(
        fillValueRadioGroup(radios, profile[eeo.field])
          ? { label, status: "filled" }
          : { label, status: "skipped-needs-review", reason: "Couldn't match your stored answer to an option." },
      );
      continue;
    }
    outcomes.push({ label, status: "skipped-needs-review", reason: "Not a question this app recognizes yet." });
  }

  for (const field of findFormFields(root)) {
    if (field instanceof HTMLInputElement && (field.type === "radio" || field.type === "checkbox")) continue;
    if (sections.handled.has(field)) continue;
    if (ctx.onlyEmpty && hasValue(field)) continue;
    const label = cleanLabel(getFieldLabel(field));
    if (!label) {
      outcomes.push({ label: "(unlabeled field)", status: "skipped-unmatched" });
      continue;
    }
    if (isCombobox(field)) {
      // A search-as-you-type dropdown: typing text doesn't choose an option, so it is left to her.
      outcomes.push({ label, status: "skipped-needs-review", reason: "A dropdown you pick from. Choose it yourself." });
      continue;
    }

    if (field instanceof HTMLSelectElement) {
      const legal = matchLegalRule(label);
      if (legal) {
        const value = legalValue(profile, legal.field);
        if (!value) {
          outcomes.push({ label, status: "skipped-no-data", reason: "No stored answer for this legal question — left for you." });
          continue;
        }
        outcomes.push(fillSelect(field, value === "yes" ? "Yes" : "No") ? { label, status: "filled" } : { label, status: "skipped-needs-review", reason: "No matching option found." });
        continue;
      }
      const eeo = matchEeoRule(label);
      if (eeo) {
        outcomes.push(
          fillSelect(field, profile[eeo.field]) ? { label, status: "filled" } : { label, status: "skipped-needs-review", reason: "Couldn't match your stored answer to an option." },
        );
        continue;
      }
      const text = matchTextRule(label);
      if (text) {
        const value = text.get(profile);
        if (!value) {
          outcomes.push({ label, status: "skipped-no-data" });
          continue;
        }
        outcomes.push(fillSelect(field, value) ? { label, status: "filled" } : { label, status: "skipped-needs-review", reason: "No matching option found." });
        continue;
      }
      outcomes.push({ label, status: "skipped-unmatched" });
      continue;
    }

    // Text-like: input[text/email/tel/...], textarea.
    const legal = matchLegalRule(label);
    const eeo = matchEeoRule(label);
    const text = matchTextRule(label);
    if (legal) {
      const value = legalValue(profile, legal.field);
      if (!value) {
        outcomes.push({ label, status: "skipped-no-data", reason: "No stored answer for this legal question — left for you." });
      } else {
        setNativeValue(field as HTMLInputElement | HTMLTextAreaElement, value === "yes" ? "Yes" : "No");
        outcomes.push({ label, status: "filled" });
      }
    } else if (eeo || text) {
      const value = eeo ? profile[eeo.field] : text!.get(profile);
      if (!value) {
        outcomes.push({ label, status: "skipped-no-data" });
      } else {
        setNativeValue(field as HTMLInputElement | HTMLTextAreaElement, value);
        outcomes.push({ label, status: "filled" });
      }
    } else if (field instanceof HTMLTextAreaElement) {
      outcomes.push({ label, status: "skipped-needs-review", reason: "Free-text question — draft one with AI, then paste it in." });
    } else {
      outcomes.push({ label, status: "skipped-unmatched" });
    }
  }

  return outcomes;
}

export { setNativeValue };

export interface FillContext {
  /** Leave anything that already has a value alone (used when new fields appear on a later step). */
  onlyEmpty?: boolean;
  /** "Your experience", for repeated work-experience blocks. */
  experiences?: SyncedExperience[];
}
