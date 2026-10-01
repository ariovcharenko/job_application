import { boldSegments, DEFAULT_LAYOUT, educationFirst, FONT, LINE_HEIGHT, LINK_COLOR, PAGE, SECTION_TITLES } from "./layout";
import type { ResumeDoc, ResumeHeader } from "./schema";

// An HTML rendering of the same layout as render.ts. Used twice: as the on-screen preview, and in
// fit.ts to measure how much of one US Letter page the resume uses. Everything is escaped; no
// model output is ever inserted as raw HTML.
//
// Word parity, so the measure is neither looser nor tighter than the .docx:
// - Word adds one paragraph's space-after to the next one's space-before; CSS collapses adjacent
//   margins to the larger of the two. Space above a section header is therefore padding, not
//   margin (contact line 3pt + first header 5pt = 8pt, as in Word; before this it measured 5pt).
// - Word doesn't kern or use ligatures by default; browsers do, which fits slightly more text on a
//   line than Word will. Both are off here.
// - Line height 1.15 is Word's "single" spacing for Times New Roman; the bullet sits 0.0625in in
//   and its text 0.1875in in, like render.ts's hanging indent (left 270, hanging 180 twips).

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const rich = (s: string) => boldSegments(s).map((p) => (p.bold ? `<b>${esc(p.text)}</b>` : esc(p.text))).join("");

/** The role shown under a project's name: "" for a generic "Project" title. */
export const projectRole = (title: string) => (/^(personal\s+|side\s+)?project$/i.test(title.trim()) ? "" : title);

const safeHref = (url: string) => (/^(https?:|mailto:)/i.test(url) ? esc(url) : "#");

// Sizes come from two CSS variables set on each page (renderResumeHtml): --b, the body font size in
// points, and --m, the line/section spacing multiple (layout.ts sizesFor / spaceFor, same offsets).
const pt = (offset: number) => `calc(var(--b) * 1pt + ${offset}pt)`;
const sp = (base: number) => `calc(var(--m) * ${base}pt)`;

export const PAGE_CSS = `
.rp{--b:${DEFAULT_LAYOUT.body};--m:${DEFAULT_LAYOUT.spacing};box-sizing:border-box;width:${PAGE.widthIn}in;min-height:${PAGE.heightIn}in;padding:${PAGE.marginYIn}in ${PAGE.marginXIn}in;background:#fff;color:#000;font-family:"${FONT}",Tinos,"Liberation Serif",serif;line-height:calc(${LINE_HEIGHT} * var(--m));font-size:${pt(0)};font-kerning:none;font-variant-ligatures:none;letter-spacing:0;word-spacing:0}
.rp *{margin:0;padding:0}
.rp .n{text-align:center;font-weight:bold;font-size:${pt(7)};margin-bottom:1pt}
.rp .c{text-align:center;font-size:${pt(0)};margin-bottom:${sp(3)}}
.rp .c a{color:#${LINK_COLOR};text-decoration:underline}
.rp .h{font-weight:bold;font-size:${pt(0.5)};border-bottom:0.75pt solid #000;padding-top:${sp(5)};padding-bottom:1pt;margin-bottom:${sp(2)}}
.rp .r{display:flex;justify-content:space-between;gap:12pt}
.rp .r>span:last-child{white-space:nowrap;flex-shrink:0}
.rp [data-b],.rp [data-sec]{cursor:pointer}
.rp [data-b]:focus-visible,.rp [data-sec]:focus-visible{outline:2px solid #7B3FE4;outline-offset:1px}
.rp .t{font-weight:bold;font-size:${pt(0.5)}}
.rp .s{font-style:italic;font-size:${pt(0)}}
.rp .e+.e{margin-top:${sp(3)}}
.rp ul{list-style:none}
.rp li{position:relative;padding-left:0.1875in;font-size:${pt(0)}}
.rp li:before{content:"\\2022";position:absolute;left:0.0625in}
.rp .k{font-size:${pt(0)}}
`;

export function renderResumeHtml(h: ResumeHeader, doc: ResumeDoc): string {
  const contact = [
    ...(h.location ? [esc(h.location)] : []),
    ...h.links.map((l) => `<a href="${safeHref(l.url)}" target="_blank" rel="noopener noreferrer">${esc(l.text)}</a>`),
  ].join(" | ");

  // data-sec / data-e / data-b mark where each piece came from, so a selection in the preview can
  // be mapped back to the document (lib/resume/engine/edit.ts Target). tabindex="0" makes each
  // one reachable by keyboard for the click-to-act menu.
  const entry = (sec: string, i: number, title: string, right: string, sub: string, subRight: string, bullets: string[]) =>
    `<div class="e" data-sec="${sec}" data-e="${i}" tabindex="0"><div class="r t"><span>${esc(title)}</span><span style="font-weight:normal">${esc(right)}</span></div>` +
    (sub || subRight ? `<div class="r s"><span>${esc(sub)}</span><span>${esc(subRight)}</span></div>` : "") +
    (bullets.length ? `<ul>${bullets.map((b, j) => `<li data-b="${j}" tabindex="0">${rich(b)}</li>`).join("")}</ul>` : "") +
    `</div>`;

  const projects = doc.projects ?? [];
  const parts = [`<div class="n">${esc(h.name)}</div>`, `<div class="c">${contact}</div>`];
  const education = () => {
    if (!doc.education.length) return;
    parts.push(`<div class="h">${SECTION_TITLES.education}</div>`);
    parts.push(...doc.education.map((e, i) => entry("education", i, e.school, e.dates, e.degree, e.location, e.bullets)));
  };
  const experience = () => {
    if (!doc.experience.length) return;
    parts.push(`<div class="h">${SECTION_TITLES.experience}</div>`);
    parts.push(...doc.experience.map((e, i) => entry("experience", i, e.title, e.dates, e.company, e.location, e.bullets)));
  };
  if (educationFirst(doc.experience.map((e) => e.dates))) {
    education();
    experience();
  } else {
    experience();
    education();
  }
  if (projects.length) {
    parts.push(`<div class="h">${SECTION_TITLES.projects}</div>`);
    // A project leads with its name; the role line shows only when it says more than "Project".
    parts.push(...projects.map((e, i) => entry("projects", i, e.company, e.dates, projectRole(e.title), e.location, e.bullets)));
  }
  if (doc.skills.length) {
    parts.push(`<div class="h">${SECTION_TITLES.skills}</div>`);
    parts.push(...doc.skills.map((l, i) => `<div class="k" data-sec="skills" data-e="${i}" tabindex="0"><b>${esc(l.category)}:</b> ${esc(l.items.join(", "))}</div>`));
  }
  if (doc.leadership.length) {
    parts.push(`<div class="h">${esc(SECTION_TITLES.leadership)}</div>`);
    parts.push(
      `<ul>${doc.leadership.map((l, i) => `<li data-sec="leadership" data-e="${i}" tabindex="0"><div class="r"><span>${esc(l.role)}</span><span>${esc(l.dates)}</span></div></li>`).join("")}</ul>`,
    );
  }
  const layout = doc.layout ?? DEFAULT_LAYOUT;
  return `<div class="rp" style="--b:${Number(layout.body)};--m:${Number(layout.spacing)}">${parts.join("")}</div>`;
}
