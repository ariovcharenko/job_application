// Pages and fields the extension must never fill: account creation and sign-in (passwords, email
// verification), and anything it can't safely operate. Pure DOM reads, tested on fixtures.

const ACCOUNT_AUTOMATION_ID = /sign-?in|signin|log-?in|createaccount|create-account|verifypassword|forgotpassword|passwordsection|registration/i;
const ACCOUNT_PATH = /\/(log-?in|sign-?in|sign-?up|register|create-?account|password)(\/|$|\?)/i;

/** True when the page (or the form being filled) is an account or sign-in step. */
export function isAccountPage(doc: Document, location: Pick<Location, "pathname"> = { pathname: "" }): boolean {
  if (ACCOUNT_PATH.test(location.pathname)) return true;
  for (const pw of doc.querySelectorAll<HTMLInputElement>('input[type="password"]')) {
    if (!pw.disabled) return true;
  }
  for (const el of doc.querySelectorAll("[data-automation-id]")) {
    if (ACCOUNT_AUTOMATION_ID.test(el.getAttribute("data-automation-id") ?? "")) return true;
  }
  return false;
}

export const ACCOUNT_PAGE_MESSAGE = "This looks like an account or sign-in page. Job Copilot never fills these. Create the account or sign in yourself, then click Fill on the application steps.";

/** A search-as-you-type dropdown (react-select and similar). Typing text into one doesn't choose an option. */
export function isCombobox(el: Element): boolean {
  return el.getAttribute("role") === "combobox" || el.getAttribute("aria-haspopup") === "listbox" || el.getAttribute("aria-autocomplete") === "list";
}

const LEGAL_SOUNDING =
  /(authoriz|eligib).{0,40}(work|employ)|sponsor|\bvisa\b|citizen|work permit|immigration|security clearance|veteran|disabilit|gender|\brace\b|ethnic|pronoun|sexual orientation|criminal|convict|background check|date of birth|\bssn\b|social security/i;

/** Questions about work authorization, sponsorship, clearance or identity. These are answered only
 * from the Profile fields (fillRules.ts); a saved essay answer or an AI draft is never offered. */
export function isLegalSounding(label: string): boolean {
  return LEGAL_SOUNDING.test(label);
}
