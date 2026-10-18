// File names for tailored resumes, and choosing one that never overwrites another job's file in
// her Tailored folder. Kept free of heavy imports (no docx/JSZip) so any page can use it.

/** Longest role slug kept in a file name; longer titles are cut at a word boundary. */
const ROLE_SLUG_MAX = 40;

const fileSlug = (s: string) => s.trim().replace(/[^\p{L}\p{N}]+/gu, "_").replace(/^_+|_+$/g, "");

/** "Alex Rivera" + "Stripe" -> "Alex_Rivera_Resume_Stripe.docx", matching the naming
 * she already used for her tailored resumes (Alex_Rivera_Resume_<Company>.docx). With a role,
 * a short slug of it is added ("..._Google_Software_Engineer.docx") so two roles at the same
 * company don't overwrite each other in her Tailored folder. */
export function tailoredFileName(fullName: string, company: string, role?: string): string {
  const nameSlug = fileSlug(fullName) || "Resume";
  const parts = [`${nameSlug}_Resume`, fileSlug(company), shortRoleSlug(role ?? "")].filter(Boolean);
  return `${parts.join("_")}.docx`;
}

function shortRoleSlug(role: string): string {
  const full = fileSlug(role);
  if (full.length <= ROLE_SLUG_MAX) return full;
  const cut = full.slice(0, ROLE_SLUG_MAX + 1);
  const atWord = cut.lastIndexOf("_");
  return (atWord > 0 ? cut.slice(0, atWord) : full.slice(0, ROLE_SLUG_MAX)).replace(/_+$/, "");
}

/** A short, stable tag for a job (4 base-36 characters from its id), e.g. "k3f9". */
export function jobTag(applicationId: number): string {
  // FNV-1a over the id's digits: stable across sessions, spreads neighbouring ids apart.
  let h = 0x811c9dc5;
  for (const ch of String(applicationId)) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return (h % 36 ** 4).toString(36).padStart(4, "0");
}

/** "X.docx" + "k3f9" -> "X_k3f9.docx" (a counter, if given, after it: "X_k3f9_2.docx"). */
export function withSuffix(name: string, tag: string, n?: number): string {
  const dot = name.lastIndexOf(".");
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : "";
  return `${stem}_${tag}${n && n > 1 ? `_${n}` : ""}${ext}`;
}

/**
 * The name to write a job's resume under. The plain name is used when no file has it yet, or when
 * the file there is this job's own earlier copy (`ownNames`: names this job's resumes were saved
 * under). Otherwise (another job's file, or one she put there herself) a short tag of this job is
 * added, then a counter, so another file is never overwritten.
 */
export async function chooseTailoredFileName(
  name: string,
  opts: { exists: (name: string) => Promise<boolean>; ownNames: ReadonlySet<string>; applicationId?: number },
): Promise<string> {
  if (opts.ownNames.has(name) || !(await opts.exists(name))) return name;
  const tag = opts.applicationId !== undefined ? jobTag(opts.applicationId) : Date.now().toString(36).slice(-4);
  for (let n = 1; n < 100; n++) {
    const candidate = withSuffix(name, tag, n);
    if (opts.ownNames.has(candidate) || !(await opts.exists(candidate))) return candidate;
  }
  return withSuffix(name, `${tag}_${Date.now().toString(36)}`);
}
