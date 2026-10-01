import { describe, expect, it } from "vitest";
import { toCsv } from "./csv";

describe("toCsv formula safety", () => {
  it("neutralizes cells that spreadsheets would run as formulas", () => {
    const out = toCsv([["Company"], ['=HYPERLINK("x")'], ["@SUM(1)"], ["-2+3"], ["Acme"]]);
    expect(out).toContain(`"'=HYPERLINK(""x"")"`);
    expect(out).toContain("'@SUM(1)");
    expect(out).toContain("'-2+3");
    expect(out.split(/\r?\n/)).toContain("Acme");
  });
});
