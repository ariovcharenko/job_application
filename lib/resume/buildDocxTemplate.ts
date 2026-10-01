import { AlignmentType, BorderStyle, Document, HeadingLevel, Packer, Paragraph, TextRun } from "docx";
import type { ResumeStructure } from "../docx/types";

/** Builds a clean, simple one-column resume .docx from a resolved ResumeStructure (bullet/skill
 * text should already have tailoring edits merged in). Used only for PDF-sourced base resumes,
 * which can't be edited in place — this will not match the original PDF's exact layout; the plan
 * accepts that tradeoff (see M3 in the project plan). For a .docx base, applyDocxEdits is used
 * instead so the original formatting survives untouched. */
export async function buildDocxTemplate(structure: ResumeStructure): Promise<ArrayBuffer> {
  const headerLines = structure.headerText.split("\n").filter(Boolean);
  const [name, ...contactLines] = headerLines;

  const children: Paragraph[] = [];

  if (name) {
    children.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 60 },
        children: [new TextRun({ text: name, bold: true, size: 32 })],
      }),
    );
  }
  for (const line of contactLines) {
    children.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 120 },
        children: [new TextRun({ text: line, size: 20 })],
      }),
    );
  }

  for (const section of structure.sections) {
    children.push(
      new Paragraph({
        heading: HeadingLevel.HEADING_2,
        spacing: { before: 200, after: 80 },
        border: { bottom: { style: BorderStyle.SINGLE, size: 4, space: 1 } },
        children: [new TextRun({ text: section.heading.toUpperCase(), bold: true, size: 22 })],
      }),
    );

    for (const line of section.context.split("\n").filter(Boolean)) {
      children.push(new Paragraph({ spacing: { after: 40 }, children: [new TextRun({ text: line, size: 20 })] }));
    }

    for (const bullet of section.bullets) {
      children.push(new Paragraph({ bullet: { level: 0 }, spacing: { after: 40 }, children: [new TextRun({ text: bullet.text, size: 20 })] }));
    }

    for (const group of section.skillGroups) {
      const runs = group.label
        ? [new TextRun({ text: `${group.label}: `, bold: true, size: 20 }), new TextRun({ text: group.items.join(", "), size: 20 })]
        : [new TextRun({ text: group.items.join(", "), size: 20 })];
      children.push(new Paragraph({ spacing: { after: 40 }, children: runs }));
    }
  }

  const doc = new Document({
    sections: [
      {
        properties: { page: { margin: { top: 720, bottom: 720, left: 720, right: 720 } } },
        children,
      },
    ],
  });

  const buffer = await Packer.toBuffer(doc);
  return new Uint8Array(buffer).buffer;
}
