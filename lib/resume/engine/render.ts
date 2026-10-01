import {
  AlignmentType,
  BorderStyle,
  Document,
  ExternalHyperlink,
  LevelFormat,
  Packer,
  Paragraph,
  Tab,
  TabStopType,
  TextRun,
  type ParagraphChild,
} from "docx";
import { boldSegments, contentWidthTwips, DEFAULT_LAYOUT, FONT, LINK_COLOR, PAGE, SECTION_TITLES, sizesFor, spaceFor, TWIPS_PER_IN, type Layout } from "./layout";
import type { ResumeDoc, ResumeHeader } from "./schema";

// Renders a tailored resume to .docx in her exact format: Times New Roman, the sizes in layout.ts,
// real hyperlinks in the header, right-aligned dates via a tab stop, and a hanging-indent "•" list.
// All text is black; only header links are #0563C1 and underlined.

const pt = (n: number) => Math.round(n * 2); // docx sizes are half-points
// The sizes and spacing of the layout being rendered (set at the start of buildResumeParagraphs).
let SIZE = sizesFor();
let SPACE = spaceFor();
const spacePt = (n: number) => Math.round(n * 20); // paragraph spacing is in twips
const BULLETS = "resume-bullets";
// Dates sit at a right tab stop on the right margin. The tab itself must be Word's <w:tab/>
// element (new Tab()): a literal "\t" inside the text isn't reliably honored (Quick Look showed
// dates unaligned with it).
const rightTab = [{ type: TabStopType.RIGHT, position: contentWidthTwips }];

function runs(text: string, size: number, extra: { italics?: boolean } = {}): TextRun[] {
  return boldSegments(text).map((s) => new TextRun({ text: s.text, bold: s.bold, size: pt(size), font: FONT, ...extra }));
}

function header(h: ResumeHeader): Paragraph[] {
  const contact: ParagraphChild[] = [];
  const pieces: (string | { text: string; url: string })[] = [...(h.location ? [h.location] : []), ...h.links];
  pieces.forEach((p, i) => {
    if (i > 0) contact.push(new TextRun({ text: " | ", size: pt(SIZE.contact), font: FONT }));
    if (typeof p === "string") contact.push(new TextRun({ text: p, size: pt(SIZE.contact), font: FONT }));
    else {
      contact.push(
        new ExternalHyperlink({
          link: p.url,
          children: [new TextRun({ text: p.text, size: pt(SIZE.contact), font: FONT, color: LINK_COLOR, underline: {} })],
        }),
      );
    }
  });
  return [
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: spacePt(SPACE.afterName) },
      children: [new TextRun({ text: h.name, bold: true, size: pt(SIZE.name), font: FONT })],
    }),
    new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: spacePt(SPACE.afterContact) }, children: contact }),
  ];
}

function sectionHeader(title: string): Paragraph {
  return new Paragraph({
    spacing: { before: spacePt(SPACE.beforeSection), after: spacePt(SPACE.afterSectionHeader) },
    border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: "000000", space: 1 } },
    children: [new TextRun({ text: title, bold: true, size: pt(SIZE.sectionHeader), font: FONT })],
  });
}

/** "Title<TAB>Dates" with the dates flush right. */
function splitLine(left: TextRun[], right: string, size: number, opts: { italics?: boolean; before?: number } = {}): Paragraph {
  return new Paragraph({
    tabStops: rightTab,
    spacing: { before: spacePt(opts.before ?? 0) },
    children: [...left, ...(right ? [new TextRun({ children: [new Tab(), right], size: pt(size), font: FONT, italics: opts.italics })] : [])],
  });
}

function bullet(text: string, size: number): Paragraph {
  return new Paragraph({ numbering: { reference: BULLETS, level: 0 }, children: runs(text, size) });
}

/** Word line spacing ("multiple", in 240ths) for a layout: single (1.15 for Times New Roman) times the spacing multiple. */
export function lineTwips(layout: Layout = DEFAULT_LAYOUT): number {
  return Math.round(240 * layout.spacing);
}

export function buildResumeParagraphs(h: ResumeHeader, doc: ResumeDoc): Paragraph[] {
  const layout = doc.layout ?? DEFAULT_LAYOUT;
  SIZE = sizesFor(layout);
  SPACE = spaceFor(layout);
  const out: Paragraph[] = [...header(h)];

  if (doc.education.length) {
    out.push(sectionHeader(SECTION_TITLES.education));
    doc.education.forEach((e, i) => {
      out.push(splitLine([new TextRun({ text: e.school, bold: true, size: pt(SIZE.entryTitle), font: FONT })], e.dates, SIZE.entryTitle, { before: i ? SPACE.beforeEntry : 0 }));
      out.push(splitLine([new TextRun({ text: e.degree, italics: true, size: pt(SIZE.entrySub), font: FONT })], e.location, SIZE.entrySub, { italics: true }));
      e.bullets.forEach((b) => out.push(bullet(b, SIZE.bullet)));
    });
  }

  if (doc.experience.length) {
    out.push(sectionHeader(SECTION_TITLES.experience));
    doc.experience.forEach((e, i) => {
      out.push(splitLine([new TextRun({ text: e.title, bold: true, size: pt(SIZE.entryTitle), font: FONT })], e.dates, SIZE.entryTitle, { before: i ? SPACE.beforeEntry : 0 }));
      out.push(splitLine([new TextRun({ text: e.company, italics: true, size: pt(SIZE.entrySub), font: FONT })], e.location, SIZE.entrySub, { italics: true }));
      e.bullets.forEach((b) => out.push(bullet(b, SIZE.bullet)));
    });
  }

  const projects = doc.projects ?? [];
  if (projects.length) {
    out.push(sectionHeader(SECTION_TITLES.projects));
    projects.forEach((e, i) => {
      out.push(splitLine([new TextRun({ text: e.title, bold: true, size: pt(SIZE.entryTitle), font: FONT })], e.dates, SIZE.entryTitle, { before: i ? SPACE.beforeEntry : 0 }));
      out.push(splitLine([new TextRun({ text: e.company, italics: true, size: pt(SIZE.entrySub), font: FONT })], e.location, SIZE.entrySub, { italics: true }));
      e.bullets.forEach((b) => out.push(bullet(b, SIZE.bullet)));
    });
  }

  if (doc.skills.length) {
    out.push(sectionHeader(SECTION_TITLES.skills));
    doc.skills.forEach((l) =>
      out.push(
        new Paragraph({
          children: [
            new TextRun({ text: `${l.category}: `, bold: true, size: pt(SIZE.skills), font: FONT }),
            new TextRun({ text: l.items.join(", "), size: pt(SIZE.skills), font: FONT }),
          ],
        }),
      ),
    );
  }

  if (doc.leadership.length) {
    out.push(sectionHeader(SECTION_TITLES.leadership));
    doc.leadership.forEach((l) =>
      out.push(
        new Paragraph({
          numbering: { reference: BULLETS, level: 0 },
          tabStops: rightTab,
          children: [
            new TextRun({ text: l.role, size: pt(SIZE.bullet), font: FONT }),
            ...(l.dates ? [new TextRun({ children: [new Tab(), l.dates], size: pt(SIZE.bullet), font: FONT })] : []),
          ],
        }),
      ),
    );
  }
  return out;
}

export async function renderResumeDocx(h: ResumeHeader, doc: ResumeDoc): Promise<ArrayBuffer> {
  const layout = doc.layout ?? DEFAULT_LAYOUT;
  const children = buildResumeParagraphs(h, doc);
  const document = new Document({
    creator: h.name,
    title: `${h.name} Resume`,
    styles: {
      default: {
        document: {
          run: { font: FONT, size: pt(sizesFor(layout).bullet), color: "000000" },
          paragraph: { spacing: { before: 0, after: 0, line: lineTwips(layout) } },
        },
      },
    },
    numbering: {
      config: [
        {
          reference: BULLETS,
          levels: [
            {
              level: 0,
              format: LevelFormat.BULLET,
              text: "•",
              alignment: AlignmentType.LEFT,
              style: { paragraph: { indent: { left: 270, hanging: 180 } } },
            },
          ],
        },
      ],
    },
    sections: [
      {
        properties: {
          page: {
            size: { width: PAGE.widthIn * TWIPS_PER_IN, height: PAGE.heightIn * TWIPS_PER_IN },
            margin: {
              top: PAGE.marginYIn * TWIPS_PER_IN,
              bottom: PAGE.marginYIn * TWIPS_PER_IN,
              left: PAGE.marginXIn * TWIPS_PER_IN,
              right: PAGE.marginXIn * TWIPS_PER_IN,
            },
          },
        },
        children,
      },
    ],
  });
  // toArrayBuffer, not toBuffer: Node's Buffer doesn't exist in the browser, where this runs.
  return Packer.toArrayBuffer(document);
}
