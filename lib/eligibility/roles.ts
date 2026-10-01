import { ROLE_TYPES, type RoleType } from "../types";

// Job families. Ordered regexes, most specific first: "ML Engineer" is AI / ML (not Software
// Engineering), "Data Engineer" is Data & Analytics, "Site Reliability Engineer" is DevOps.

/** Role types from before database v4 -> the family that replaced them. */
export const LEGACY_ROLE_TYPES: Record<string, RoleType> = {
  SWE: "Software Engineering",
  "AI Engineer": "AI / ML",
  Product: "Product Management",
  "UX/UI": "Design (UX/UI)",
};

const RULES: [RegExp, RoleType][] = [
  [/\bux\b|\bui\s*\/\s*ux\b|\bui designer|user experience|user research|product designer|interaction designer|visual designer|\bdesigner\b|\bdesign \(ux/, "Design (UX/UI)"],
  [/\bproduct manager\b|\bproduct management\b|\bproduct owner\b|\b(associate |senior |group |technical )?pm\b|\bapm\b/, "Product Management"],
  [/\bsecurity\b|\bcyber|\bappsec\b|penetration|\binfosec\b|\bsoc analyst\b/, "Security"],
  [/\bml\b|\bai\b|machine learning|deep learning|artificial intelligence|\bllms?\b|\bnlp\b|computer vision|\bgenai\b|generative ai|\bmlops\b|applied scientist|research scientist|\bai \/ ml\b/, "AI / ML"],
  [/\bdevsecops\b|\bdevops\b|site reliability|\bsre\b|\bcloud (engineer|architect|infrastructure)|\bplatform engineer|\binfrastructure engineer|\bkubernetes\b/, "DevOps / SRE / Cloud"],
  [/\bdata (engineer|analyst|scientist|science|analytics|architect)|\banalytics\b|business intelligence|\bbi (developer|analyst|engineer)\b|\bdata\b|\bstatistician\b/, "Data & Analytics"],
  [/\bqa\b|quality assurance|\btest(ing)? (engineer|automation|analyst)|\bsdet\b|\bquality engineer|\bautomation tester\b/, "QA / Test"],
  [/\bios\b|\bandroid\b|\bmobile\b|react native|\bflutter\b/, "Mobile"],
  [/\bfront[- ]?end\b|\bweb (developer|engineer|designer)\b|\bui engineer\b|\breact (developer|engineer)\b|frontend\/web/, "Frontend/Web"],
  [/\bembedded\b|\bfirmware\b|\bhardware\b|\bfpga\b|\basic\b|\belectrical engineer|design verification|\brtos\b/, "Embedded / Hardware"],
  [/\bit (support|specialist|technician|administrator|analyst|manager)\b|help ?desk|desktop support|systems? administrator|\bsysadmin\b|technical support|support engineer|network (engineer|administrator)/, "IT / Support"],
  [/\bswe\b|software|engineer|developer|programmer|full[- ]?stack|back[- ]?end|\bcoder\b/, "Software Engineering"],
];

/** The job family for a title or a role-type label ("Senior ML Engineer" -> "AI / ML"). */
export function normalizeRoleType(raw: string): RoleType {
  const trimmed = raw.trim();
  const exact = ROLE_TYPES.find((x) => x.toLowerCase() === trimmed.toLowerCase());
  if (exact) return exact;
  const legacy = Object.entries(LEGACY_ROLE_TYPES).find(([k]) => k.toLowerCase() === trimmed.toLowerCase());
  if (legacy) return legacy[1];
  const s = trimmed.toLowerCase();
  return RULES.find(([re]) => re.test(s))?.[1] ?? "Other";
}

/** A stored role type from any version: known families stay, old names are remapped, anything else is re-derived. */
export function migrateRoleType(stored: string | undefined, title = ""): RoleType {
  if (stored && (ROLE_TYPES as readonly string[]).includes(stored)) return stored as RoleType;
  if (stored && LEGACY_ROLE_TYPES[stored]) return LEGACY_ROLE_TYPES[stored];
  return stored && stored !== "Other" ? normalizeRoleType(stored) : title ? normalizeRoleType(title) : "Other";
}
