// Page geometry and type sizes from her resume spec, shared by the .docx renderer and the HTML
// preview so the one-page check measures the same layout that gets downloaded.

export const PAGE = {
  widthIn: 8.5,
  heightIn: 11,
  marginXIn: 0.4,
  marginYIn: 0.3,
};

export const FONT = "Times New Roman";
export const LINK_COLOR = "0563C1";

/** Sizes in points. */
export const SIZE = {
  name: 17,
  contact: 9.5,
  sectionHeader: 10,
  entryTitle: 9.5,
  entrySub: 9,
  bullet: 9,
  skills: 9,
};

/** Word's "single" line height for Times New Roman is ~1.15x the font size. */
export const LINE_HEIGHT = 1.15;

/** Vertical spacing, in points. */
export const SPACE = {
  afterName: 1,
  afterContact: 3,
  beforeSection: 5,
  afterSectionHeader: 2,
  beforeEntry: 3,
};

export const SECTION_TITLES = {
  education: "EDUCATION",
  experience: "EXPERIENCE",
  skills: "TECHNICAL SKILLS",
  leadership: "LEADERSHIP & INVOLVEMENT",
};

export const TWIPS_PER_IN = 1440;
export const contentWidthTwips = Math.round((PAGE.widthIn - 2 * PAGE.marginXIn) * TWIPS_PER_IN);

/** "**React** and **Jest**" -> [{text:"React",bold:true},{text:" and "},{text:"Jest",bold:true}]. */
export function boldSegments(text: string): { text: string; bold: boolean }[] {
  const parts = text.split("**");
  return parts.map((t, i) => ({ text: t, bold: i % 2 === 1 })).filter((p) => p.text !== "");
}
