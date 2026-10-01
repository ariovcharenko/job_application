import { describe, expect, it } from "vitest";
import { extractVisibleText } from "./pageText";

describe("extractVisibleText", () => {
  it("collapses excess whitespace and blank lines", () => {
    document.body.innerHTML = `<div id="r">Hello   world\n\n\n\nBye</div>`;
    const text = extractVisibleText(document.getElementById("r")!);
    expect(text).toBe("Hello world\n\nBye");
  });

  it("caps extremely long pages", () => {
    document.body.innerHTML = `<div id="r">${"x".repeat(50_000)}</div>`;
    const text = extractVisibleText(document.getElementById("r")!);
    expect(text.length).toBeLessThanOrEqual(20_000);
  });
});
