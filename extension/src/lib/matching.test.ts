import { describe, expect, it } from "vitest";
import { findFormFields, getFieldLabel, isFillable } from "./matching";

function setBody(html: string) {
  document.body.innerHTML = html;
}

describe("getFieldLabel", () => {
  it("prefers aria-label over everything else", () => {
    setBody(`<input id="a" aria-label="Email address" placeholder="you@example.com" name="email" />`);
    const el = document.getElementById("a") as HTMLInputElement;
    expect(getFieldLabel(el)).toBe("Email address");
  });

  it("finds a label via for=", () => {
    setBody(`<label for="first">First name</label><input id="first" />`);
    const el = document.getElementById("first") as HTMLInputElement;
    expect(getFieldLabel(el)).toBe("First name");
  });

  it("finds a wrapping label without leaking the input's own value", () => {
    setBody(`<label>Phone number <input id="p" value="555-1234" /></label>`);
    const el = document.getElementById("p") as HTMLInputElement;
    expect(getFieldLabel(el)).toBe("Phone number");
  });

  it("falls back to placeholder", () => {
    setBody(`<input id="x" placeholder="LinkedIn URL" />`);
    const el = document.getElementById("x") as HTMLInputElement;
    expect(getFieldLabel(el)).toBe("LinkedIn URL");
  });

  it("falls back to a humanized name attribute", () => {
    setBody(`<input id="y" name="earliest_start_date" />`);
    const el = document.getElementById("y") as HTMLInputElement;
    expect(getFieldLabel(el)).toBe("earliest start date");
  });

  it("humanizes camelCase names too", () => {
    setBody(`<input id="z" name="graduationYear" />`);
    const el = document.getElementById("z") as HTMLInputElement;
    expect(getFieldLabel(el)).toBe("graduation year");
  });

  it("resolves aria-labelledby to the referenced element's text", () => {
    setBody(`<span id="lbl">Work authorization</span><input id="w" aria-labelledby="lbl" />`);
    const el = document.getElementById("w") as HTMLInputElement;
    expect(getFieldLabel(el)).toBe("Work authorization");
  });

  it("falls back to a humanized id when there's no name", () => {
    setBody(`<input id="mystery_field" />`);
    const el = document.getElementById("mystery_field") as HTMLInputElement;
    expect(getFieldLabel(el)).toBe("mystery field");
  });

  it("returns empty string when there's truly nothing to go on", () => {
    document.body.innerHTML = "";
    const el = document.createElement("input");
    document.body.appendChild(el);
    expect(getFieldLabel(el)).toBe("");
  });
});

describe("isFillable / findFormFields", () => {
  it("excludes submit, button, hidden and file inputs", () => {
    setBody(`
      <form>
        <input type="text" name="a" />
        <input type="submit" value="Submit" />
        <input type="button" value="Cancel" />
        <input type="hidden" name="csrf" />
        <input type="file" name="resume" />
        <select name="s"><option>1</option></select>
        <textarea name="t"></textarea>
      </form>
    `);
    const fields = findFormFields(document.body);
    expect(fields.map((f) => f.tagName + (f instanceof HTMLInputElement ? `[${f.type}]` : ""))).toEqual([
      "INPUT[text]",
      "SELECT",
      "TEXTAREA",
    ]);
  });

  it("excludes disabled fields", () => {
    setBody(`<input type="text" name="a" disabled />`);
    const el = document.querySelector("input")!;
    expect(isFillable(el)).toBe(false);
  });
});
