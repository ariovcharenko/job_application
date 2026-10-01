import { describe, expect, it } from "vitest";
import { looksRemote, matchRegion } from "./regions";

describe("matchRegion", () => {
  it.each([
    ["Irvine, CA", "Orange County, CA"],
    ["Costa Mesa, California", "Orange County, CA"],
    ["Santa Monica, CA (Hybrid)", "Los Angeles, CA"],
    ["Los Angeles", "Los Angeles, CA"],
    ["Mountain View, CA", "San Francisco Bay Area, CA"],
    ["SF Bay Area", "San Francisco Bay Area, CA"],
    ["Chicago, IL", "Chicago, IL"],
  ])("%s -> %s", (input, expected) => {
    expect(matchRegion(input)).toBe(expected);
  });

  it("returns null for unknown or empty locations", () => {
    expect(matchRegion("")).toBeNull();
    expect(matchRegion("Fargo, ND")).toBeNull();
  });

  it("rejects a place whose stated state is different", () => {
    expect(matchRegion("Glendale, AZ")).toBeNull();
    expect(matchRegion("Glendale, CA")).toBe("Los Angeles, CA");
    expect(matchRegion("Long Beach, NY")).toBeNull();
  });

  it("matches whole words only", () => {
    // "orange" alone (e.g. "Orange, NJ") must not count; only "orange county" or the OC cities do
    expect(matchRegion("Orange, NJ")).toBeNull();
    expect(matchRegion("Davis Polk, New York")).toBe("New York, NY");
  });
});

describe("looksRemote", () => {
  it("detects remote wording", () => {
    expect(looksRemote("Remote (US)")).toBe(true);
    expect(looksRemote("Work from home")).toBe(true);
    expect(looksRemote("Irvine, CA")).toBe(false);
  });
});
