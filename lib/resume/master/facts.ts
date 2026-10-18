import type { RoleKey } from "./skills";

// Facts she typed while tailoring (an answer to "How many users did it reach?"), kept in her
// experience under their own heading, each tied to the exact role or project it is about:
//   ### Facts you added
//   - Brightloop | Software Engineer Intern: about 900 daily users
// Her typed answer is her confirmation (decision #6). validate.ts reads these facts as part of
// that role's own text only, so a number she gave for one role is accepted there and still flagged
// anywhere else. The heading avoids the words "experience", "project" and "skill" on purpose, so
// these lines are never read as roles or skills.

export const FACTS_HEADING = "Facts you added";

export interface RoleFact {
  role: RoleKey;
  text: string;
}

const clean = (s: string) => s.replace(/\s+/g, " ").trim().replace(/^[-*•]\s*/, "").trim();

/** Every fact under the heading, in order. */
export function parseRoleFacts(master: string): RoleFact[] {
  const out: RoleFact[] = [];
  let inside = false;
  for (const raw of master.split(/\r?\n/)) {
    const line = raw.trim();
    const h = line.match(/^#{1,6}\s+(.*)$/);
    if (h) {
      inside = h[1].trim().toLowerCase().startsWith(FACTS_HEADING.toLowerCase());
      continue;
    }
    if (!inside) continue;
    const m = line.replace(/\*\*/g, "").match(/^[-*•]\s*([^:]{1,200}):\s*(.+)$/);
    if (!m) continue;
    const [company, ...title] = m[1].split("|").map((p) => p.trim());
    if (company && m[2].trim()) out.push({ role: { company, title: title.join(" | ") }, text: m[2].trim() });
  }
  return out;
}

/** Her experience with one more fact for this role (created under its heading; an identical one isn't added twice). */
export function appendRoleFact(master: string, role: RoleKey, text: string): string {
  const fact = clean(text);
  if (!fact || !role.company.trim()) return master;
  const key = `${role.company.trim()}${role.title.trim() ? ` | ${role.title.trim()}` : ""}`;
  const line = `- ${key}: ${fact}`;
  const same = (f: RoleFact) =>
    f.role.company.toLowerCase() === role.company.trim().toLowerCase() && f.role.title.toLowerCase() === role.title.trim().toLowerCase() && f.text.toLowerCase() === fact.toLowerCase();
  if (parseRoleFacts(master).some(same)) return master;
  const lines = master.split(/\r?\n/);
  const heading = lines.findIndex((l) => new RegExp(`^#{1,6}\\s+${FACTS_HEADING}`, "i").test(l.trim()));
  if (heading < 0) return `${master.trimEnd()}\n\n### ${FACTS_HEADING}\n${line}\n`;
  let end = heading + 1;
  while (end < lines.length && !/^#{1,6}\s/.test(lines[end].trim())) end++;
  let last = end - 1;
  while (last > heading && !lines[last].trim()) last--;
  lines.splice(last + 1, 0, line);
  return lines.join("\n");
}
