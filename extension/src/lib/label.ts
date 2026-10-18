/** A field's label without the decoration ATS forms add: required asterisks, "(required)",
 * "(optional)", a trailing colon. Rules match against this, so "First Name *" is "First Name". */
export function cleanLabel(label: string): string {
  return label
    .replace(/[*✱∗]/g, " ")
    .replace(/\((required|optional)\)/gi, " ")
    .replace(/\b(required|optional)\s*$/i, " ")
    .replace(/\s+/g, " ")
    .replace(/[\s:]+$/, "")
    .trim();
}
