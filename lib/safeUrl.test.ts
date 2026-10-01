import { describe, expect, it } from "vitest";
import { safeHttpUrl } from "./safeUrl";

describe("safeHttpUrl", () => {
  it.each([
    ["https://www.linkedin.com/in/someone", "https://www.linkedin.com/in/someone"],
    ["HTTP://acme.com", "HTTP://acme.com"],
    ["linkedin.com/in/someone", "https://linkedin.com/in/someone"],
    ["  acme.com/jobs  ", "https://acme.com/jobs"],
    ["localhost:3000/x", "https://localhost:3000/x"],
    ["", ""],
    ["   ", ""],
    ["javascript:alert(1)", ""],
    ["JavaScript:alert(1)", ""],
    ["data:text/html,<script>alert(1)</script>", ""],
    ["vbscript:msgbox", ""],
    ["mailto:someone@acme.com", ""],
  ])("%j -> %j", (input, expected) => {
    expect(safeHttpUrl(input)).toBe(expected);
  });
});
