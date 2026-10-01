import { parseMasterExperiences } from "../master/experiences";
import { hasSkill, parseSkillInventory } from "../master/skills";
import { boldSpansTouch } from "./polish";
import type { ResumeDoc, ResumeHeader } from "./schema";
import { FILL_TARGET, FIT_LIMIT } from "./trim";
import { numbersIn, plain } from "./validate";

// Her last step: before the resume is shown or downloaded, check the finished page and report
// anything that fails. Code already fixes what it can (dashes, dates, bold spacing, the fit
// loop); these checks are the proof, shown in the Checks list.

export interface VerifyCheck {
  id: "one-page" | "fill" | "links" | "dashes" | "bold" | "skills" | "numbers" | "dates";
  ok: boolean;
  label: string;
}

const DASHES = /—|–|--/;

/** Every string on the page (header included), for character-level checks. */
function allText(header: ResumeHeader, doc: ResumeDoc): string[] {
  return [
    header.name,
    header.location,
    ...header.links.map((l) => l.text),
    ...doc.education.flatMap((e) => [e.school, e.location, e.degree, e.dates, ...e.bullets]),
    ...[...doc.experience, ...(doc.projects ?? [])].flatMap((e) => [e.title, e.company, e.location, e.dates, ...e.bullets]),
    ...doc.skills.flatMap((l) => [l.category, ...l.items]),
    ...doc.leadership.flatMap((l) => [l.role, l.dates]),
  ];
}

/** A link the header can carry: an email (mailto:) or a full http(s) web address, never edited. */
export function linkOk(url: string): boolean {
  if (/^mailto:[^\s@]+@[^\s@]+\.[^\s@]+$/i.test(url)) return true;
  try {
    const u = new URL(url);
    return (u.protocol === "https:" || u.protocol === "http:") && u.hostname.includes(".");
  } catch {
    return false;
  }
}

export function verifyResume(input: {
  header: ResumeHeader;
  doc: ResumeDoc;
  fits: boolean;
  fill: number;
  master: string;
  /** Skills she ticked "I have this" for in this session (already on her list after saving). */
  extraSkills?: string[];
}): VerifyCheck[] {
  const { header, doc, fits, fill, master } = input;
  const pct = Math.round(fill * 100);
  const inventory = [...parseSkillInventory(master), ...(input.extraSkills ?? [])];
  const entries = parseMasterExperiences(master);
  const masterNumbers = new Set(numbersIn(master));
  const roles = [...doc.experience, ...(doc.projects ?? [])];
  const bullets = [...roles.flatMap((e) => e.bullets), ...doc.education.flatMap((e) => e.bullets)];

  const badLinks = header.links.filter((l) => !linkOk(l.url));
  const dashed = allText(header, doc).filter((t) => DASHES.test(t));
  const touching = bullets.filter(boldSpansTouch);
  const unknownSkills = doc.skills.flatMap((l) => l.items).filter((i) => !hasSkill(i, inventory, ""));
  const unknownNumbers = [...new Set(bullets.flatMap((b) => numbersIn(plain(b))).filter((n) => !masterNumbers.has(n)))];
  const wrongDates = roles.filter((e) => {
    const m = entries.find((x) => x.company.toLowerCase() === e.company.toLowerCase());
    return m ? m.dates.replace(/\s*[-–—]+\s*/g, " - ").trim() !== e.dates.trim() : false;
  });

  return [
    { id: "one-page", ok: fits, label: fits ? "One page." : "Doesn't fit on one page." },
    {
      id: "fill",
      ok: fits && fill >= FILL_TARGET && fill <= FIT_LIMIT,
      label: fill < FILL_TARGET ? `Fills ${pct}% of the page (aim: ${Math.round(FILL_TARGET * 100)} to ${Math.round(FIT_LIMIT * 100)}%).` : `Fills ${pct}% of the page.`,
    },
    {
      id: "links",
      ok: badLinks.length === 0,
      label: badLinks.length ? `Check these header links in Profile: ${badLinks.map((l) => l.text).join(", ")}.` : `${header.links.length} header link${header.links.length === 1 ? "" : "s"}, exactly as in your Profile.`,
    },
    { id: "dashes", ok: dashed.length === 0, label: dashed.length ? `Dash characters left in: ${dashed.slice(0, 2).join("; ")}` : "No dash characters; dates read \"Mon YYYY - Mon YYYY\"." },
    { id: "bold", ok: touching.length === 0, label: touching.length ? `Bold text runs together in ${touching.length} bullet(s).` : "Bold only on technologies and numbers, never run together." },
    {
      id: "skills",
      ok: unknownSkills.length === 0,
      label: unknownSkills.length ? `Not on your skills list: ${unknownSkills.join(", ")}.` : "Every skill is on your skills list.",
    },
    {
      id: "numbers",
      ok: unknownNumbers.length === 0,
      label: unknownNumbers.length ? `Numbers not in your experience: ${unknownNumbers.join(", ")}.` : "Every number comes from your experience.",
    },
    {
      id: "dates",
      ok: wrongDates.length === 0,
      label: wrongDates.length ? `Dates differ from your experience for ${wrongDates.map((e) => e.company).join(", ")}.` : "Every date matches your experience.",
    },
  ];
}
