import { cleanTitle, parseMasterExperiences, type MasterEntry } from "../master/experiences";
import type { RoleKey } from "../master/skills";
import type { ResumeDoc } from "./schema";

// The roles and projects on the page she can place a skill in ("Skills and Acme (Intern)"), as
// written in her experience. Built from the whole page, struck-through lines included: a role
// waiting for her OK is still hers, and leaving it out hid it from the picker (2026-10-25).

export interface PlaceChoice {
  key: string;
  label: string;
  role: RoleKey;
  section: "experience" | "projects";
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** The master entry a page entry is: the same company, or one name containing the other ("Acme" / "Acme, Ads Team"). */
export function masterEntryFor(entries: MasterEntry[], company: string): MasterEntry | undefined {
  const c = norm(company);
  if (!c) return undefined;
  return (
    entries.find((x) => norm(x.company) === c) ??
    entries.find((x) => ` ${norm(x.company)} `.includes(` ${c} `) || ` ${c} `.includes(` ${norm(x.company)} `))
  );
}

/** Every role and project on the page, each once, in page order. */
export function placeOptions(doc: ResumeDoc, master: string): PlaceChoice[] {
  const entries = parseMasterExperiences(master);
  const out: PlaceChoice[] = [];
  (["experience", "projects"] as const).forEach((section) =>
    (doc[section] ?? []).forEach((e) => {
      const m = masterEntryFor(entries, e.company);
      if (!m) return;
      const role = { company: m.company, title: cleanTitle(m.title) };
      const key = `${section}:${norm(m.company)}:${norm(role.title)}`;
      if (out.some((p) => p.key === key)) return;
      out.push({ key, label: section === "projects" ? m.company : `${m.company} (${role.title})`, role, section });
    }),
  );
  return out;
}

/** Where a placed skill's role sits in this document, or undefined when it isn't on it. */
export function placeTarget(doc: ResumeDoc, company: string): { section: "experience" | "projects"; entry: number } | undefined {
  const c = norm(company);
  for (const section of ["experience", "projects"] as const) {
    const i = (doc[section] ?? []).findIndex((e) => {
      const n = norm(e.company);
      return n === c || ` ${c} `.includes(` ${n} `) || ` ${n} `.includes(` ${c} `);
    });
    if (i >= 0) return { section, entry: i };
  }
  return undefined;
}
