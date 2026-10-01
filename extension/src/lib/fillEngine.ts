import { findFormFields, getFieldLabel } from "./matching";
import { matchEeoRule, matchLegalRule, matchTextRule } from "./fillRules";
import type { FillOutcome, SyncedProfile } from "../types";

function setNativeValue(el: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  const proto = el instanceof HTMLTextAreaElement ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
  // Many ATS forms (Greenhouse, Ashby) are React-controlled and ignore a plain `el.value = x`
  // assignment — using the prototype's native setter first is what makes React's change
  // detection actually notice the update.
  if (setter) setter.call(el, value);
  else el.value = value;
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
}

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

const DECLINE_PATTERN = /decline|prefer not|don'?t wish|not specified|choose not/i;

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
export function fillForm(root: ParentNode, profile: SyncedProfile): FillOutcome[] {
  const outcomes: FillOutcome[] = [];
  const handledNames = new Set<string>();

  // Radio groups first, since findFormFields would otherwise treat each option as its own field.
  for (const [name, radios] of groupRadios(root)) {
    handledNames.add(name);
    const label = getGroupLabel(radios);
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
    const label = getFieldLabel(field);
    if (!label) {
      outcomes.push({ label: "(unlabeled field)", status: "skipped-unmatched" });
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
