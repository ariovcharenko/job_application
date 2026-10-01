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

/**
 * What the fit loop may change to fill the page: the body font size (pt) and a multiple applied to
 * line height and to the space between sections and entries. Everything else scales from these.
 */
export interface Layout {
  body: number;
  spacing: number;
}

export const MIN_BODY_PT = 10;
export const MAX_BODY_PT = 11;
export const BODY_STEP_PT = 0.25;
export const MIN_SPACING = 1;
export const MAX_SPACING = 1.15;
export const SPACING_STEP = 0.05;

export const DEFAULT_LAYOUT: Layout = { body: MIN_BODY_PT, spacing: MIN_SPACING };

/** Sizes in points for a layout: the name, headers and titles keep their offsets from the body text. */
export function sizesFor(layout: Layout = DEFAULT_LAYOUT) {
  const b = layout.body;
  return {
    name: b + 8,
    contact: b + 0.5,
    sectionHeader: b + 1,
    entryTitle: b + 0.5,
    entrySub: b,
    bullet: b,
    skills: b,
  };
}

/** Word's "single" line height for Times New Roman is ~1.15x the font size. */
export const LINE_HEIGHT = 1.15;

/** Vertical spacing in points for a layout. */
export function spaceFor(layout: Layout = DEFAULT_LAYOUT) {
  const m = layout.spacing;
  return {
    afterName: 1,
    afterContact: 3 * m,
    beforeSection: 5 * m,
    afterSectionHeader: 2 * m,
    beforeEntry: 3 * m,
  };
}

export const SIZE = sizesFor();
export const SPACE = spaceFor();

export const SECTION_TITLES = {
  education: "EDUCATION",
  experience: "EXPERIENCE",
  projects: "PROJECTS",
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
