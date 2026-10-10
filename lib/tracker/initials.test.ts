import { describe, expect, it } from "vitest";
import { companyInitials } from "./initials";

describe("companyInitials", () => {
  it("uses one letter for a one-word name", () => {
    expect(companyInitials("Stripe")).toBe("S");
    expect(companyInitials("DoorDash")).toBe("D");
    expect(companyInitials("iRobot")).toBe("I");
  });

  it("uses the first letters of the first two words", () => {
    expect(companyInitials("Atlas Cloud")).toBe("AC");
    expect(companyInitials("Harbor Analytics Platform")).toBe("HA");
    expect(companyInitials("cobalt payments")).toBe("CP");
  });

  it("ignores legal suffixes, filler words and punctuation", () => {
    expect(companyInitials("Stripe, Inc.")).toBe("S");
    expect(companyInitials("The Home Depot, Inc.")).toBe("HD");
    expect(companyInitials("Acme Corp")).toBe("A");
    expect(companyInitials("Johnson & Johnson")).toBe("JJ");
    expect(companyInitials("Procter and Gamble Co.")).toBe("PG");
    expect(companyInitials("Summit AI, LLC")).toBe("SA");
    expect(companyInitials("Bank of America")).toBe("BA");
  });

  it("drops parentheticals", () => {
    expect(companyInitials("Meta (Facebook)")).toBe("M");
    expect(companyInitials("Acme [contract role]")).toBe("A");
  });

  it("splits on hyphens, dots and slashes", () => {
    expect(companyInitials("Hewlett-Packard")).toBe("HP");
    expect(companyInitials("booking.com")).toBe("BC");
  });

  it("keeps digits and handles symbols", () => {
    expect(companyInitials("3M")).toBe("3");
    expect(companyInitials("23andMe")).toBe("2");
    expect(companyInitials("@Home Networks")).toBe("HN");
    expect(companyInitials("McDonald's")).toBe("M");
  });

  it("handles accents and other scripts", () => {
    expect(companyInitials("Électricité de France")).toBe("ÉD");
    expect(companyInitials("ソニー")).toBe("ソ");
  });

  it("falls back to the typed words when every word is filler", () => {
    expect(companyInitials("The Company")).toBe("TC");
  });

  it("returns an empty string when nothing usable is left", () => {
    expect(companyInitials("")).toBe("");
    expect(companyInitials("   ")).toBe("");
    expect(companyInitials("—")).toBe("");
    expect(companyInitials(undefined)).toBe("");
    expect(companyInitials("(stealth)")).toBe("");
  });
});
