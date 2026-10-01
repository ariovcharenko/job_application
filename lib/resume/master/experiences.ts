import type { ResumeDoc } from "../engine/schema";

// The roles in her master profile, read from heading lines like
// "**Software Engineer Intern | Brightloop | Chicago, IL | May 2026 - Aug 2026**", so she can swap one
// on the page for another that fits the job better, and so validate.ts can check a role's title,
// dates, location and numbers against that one entry rather than the whole profile.

export interface MasterEntry {
  /** As written, including any "(alt. title: X)" note; see cleanTitle / altTitle. */
  title: string;
  company: string;
  /** "" when the heading has only title | company | dates. */
  location: string;
  dates: string;
  /** The master profile's section it's under ("Experience", "Projects"...), for grouping. */
  section: string;
  /** The heading line and every line under it up to the next role or section heading. */
  block: string;
}

const ALT_TITLE = /\s*\(\s*alt\.?\s*title\s*:?\s*([^)]*)\)/i;

/** "Founding Software Engineer (alt. title: Product & UX Engineer)" -> "Founding Software Engineer". */
export function cleanTitle(title: string): string {
  return title.replace(new RegExp(ALT_TITLE.source, "gi"), "").trim();
}

/** The "(alt. title: X)" part of a title, or "" if it has none. */
export function altTitle(title: string): string {
  return title.match(ALT_TITLE)?.[1].trim() ?? "";
}

export function parseMasterExperiences(master: string): MasterEntry[] {
  const out: MasterEntry[] = [];
  let section = "";
  let current: { entry: MasterEntry; lines: string[] } | null = null;
  const close = () => {
    if (current) out.push({ ...current.entry, block: current.lines.join("\n").trim() });
    current = null;
  };
  for (const raw of master.split(/\r?\n/)) {
    const line = raw.trim();
    const heading = line.match(/^#{1,6}\s+(.*)$/);
    if (heading) {
      close();
      section = heading[1].replace(/\*\*/g, "").trim();
      continue;
    }
    if (/skill|education|leadership|involvement/i.test(section)) continue;
    const bold = line.match(/^\*\*(.+?)\*\*$/);
    const parts = bold ? bold[1].split("|").map((p) => p.trim()).filter(Boolean) : [];
    if (parts.length >= 3) {
      close();
      const location = parts.length >= 4 ? parts[2] : "";
      current = { entry: { title: parts[0], company: parts[1], location, dates: parts[parts.length - 1], section, block: "" }, lines: [line] };
      continue;
    }
    current?.lines.push(line);
  }
  close();
  return out;
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** Master entries that aren't on the page yet (matched by company and title). */
export function entriesNotOnPage(master: string, doc: ResumeDoc): MasterEntry[] {
  const onPage = new Set(doc.experience.map((e) => `${norm(e.company)}|${norm(e.title.replace(/\(.*?\)/g, ""))}`));
  return parseMasterExperiences(master).filter((m) => !onPage.has(`${norm(m.company)}|${norm(m.title.replace(/\(.*?\)/g, ""))}`));
}
