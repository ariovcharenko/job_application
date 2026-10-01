// Uses @xmldom/xmldom (not the browser's native DOMParser) everywhere, including in the app
// bundle, so parsing behaves identically in the browser and under Vitest's Node environment.
// Its Document/Element/Node types are imported explicitly (not lib.dom's) since xmldom's DOM
// implementation is structurally different (e.g. no full CSSOM/event-target surface).
import { DOMParser, XMLSerializer, type Document, type Element, type Node } from "@xmldom/xmldom";

const W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const W14_NS = "http://schemas.microsoft.com/office/word/2010/wordml";

export function parseXml(xml: string): Document {
  return new DOMParser().parseFromString(xml, "text/xml");
}

export function serializeXml(doc: Document): string {
  return new XMLSerializer().serializeToString(doc);
}

export function children(el: Element, localName: string): Element[] {
  const out: Element[] = [];
  for (let i = 0; i < el.childNodes.length; i++) {
    const n = el.childNodes[i];
    if (n.nodeType === 1 && (n as Element).localName === localName) out.push(n as Element);
  }
  return out;
}

export function child(el: Element, localName: string): Element | null {
  return children(el, localName)[0] ?? null;
}

export function paraId(p: Element): string {
  return p.getAttributeNS(W14_NS, "paraId") || p.getAttribute("w14:paraId") || "";
}

/** True if this w:p has a w:pPr/w:numPr (i.e. it's a bulleted/numbered list item). */
export function isBulletParagraph(p: Element): boolean {
  const pPr = child(p, "pPr");
  return !!pPr && !!child(pPr, "numPr");
}

/** Plain text of a w:p — every w:t in document order, ignoring runs from deleted-text tracking. */
export function paragraphText(p: Element): string {
  let out = "";
  const walk = (node: Node) => {
    for (let i = 0; i < node.childNodes.length; i++) {
      const n = node.childNodes[i];
      if (n.nodeType === 1) {
        const el = n as Element;
        if (el.localName === "t") out += el.textContent ?? "";
        else if (el.localName === "tab") out += "\t";
        else if (el.localName === "br" || el.localName === "cr") out += "\n";
        else if (el.localName !== "delText") walk(el);
      }
    }
  };
  walk(p);
  return out;
}

/** True if any run directly inside this w:p (not inside a hyperlink) is bold. */
export function runIsBold(r: Element): boolean {
  const rPr = child(r, "rPr");
  return !!rPr && !!child(rPr, "b");
}

export function bodyParagraphs(doc: Document): Element[] {
  const body = doc.getElementsByTagNameNS(W_NS, "body")[0] ?? doc.getElementsByTagName("w:body")[0];
  if (!body) return [];
  return children(body as unknown as Element, "p");
}

export { W_NS, W14_NS };
