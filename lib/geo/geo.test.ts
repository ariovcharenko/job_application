import { beforeAll, describe, expect, it } from "vitest";
import { choiceFromText, choiceLabel, parseChoice } from "./choices";
import { buildIndex, getGeo, loadGeo, type GeoIndex } from "./index";
import { matchLocation } from "./match";
import { parseLocation } from "./parse";
import { searchPlaces } from "./search";
import * as data from "./usPlaces";

let geo: GeoIndex;
beforeAll(async () => {
  geo = await loadGeo();
});

describe("place data", () => {
  it("has all 50 states plus DC, and about 120 metros", () => {
    expect(data.STATES).toHaveLength(51);
    expect(data.METROS.length).toBeGreaterThanOrEqual(110);
  });

  it("uses only real state codes, and every metro lists cities in the states it spans", () => {
    const codes = new Set(data.STATES.map(([c]) => c));
    for (const m of data.METROS) {
      for (const s of m.states) expect(codes.has(s), `${m.slug}: ${s}`).toBe(true);
      for (const s of Object.keys(m.cities)) expect(m.states.includes(s), `${m.slug} lists cities in ${s}`).toBe(true);
      for (const inc of m.includes ?? []) expect(data.METROS.some((x) => x.slug === inc)).toBe(true);
    }
    for (const s of Object.keys(data.OTHER_CITIES)) expect(codes.has(s)).toBe(true);
  });

  it("has no city listed twice in the same state, and no duplicate metro slugs", () => {
    const seen = new Map<string, string>();
    const dupes: string[] = [];
    const add = (name: string, state: string, where: string) => {
      const key = `${name.trim().toLowerCase()}|${state}`;
      if (!name.trim()) return;
      if (seen.has(key)) dupes.push(`${key} in ${seen.get(key)} and ${where}`);
      else seen.set(key, where);
    };
    for (const m of data.METROS) for (const [st, list] of Object.entries(m.cities)) list.split(",").forEach((n) => add(n, st, m.slug));
    for (const [st, list] of Object.entries(data.OTHER_CITIES)) list.split(",").forEach((n) => add(n, st, "other"));
    expect(dupes).toEqual([]);
    expect(new Set(data.METROS.map((m) => m.slug)).size).toBe(data.METROS.length);
    expect(geo.cities.length).toBeGreaterThan(1000);
  });

  it("keeps Orange County, LA, SF Bay Area, Silicon Valley and San Diego as separate metros", () => {
    for (const slug of ["oc", "la", "sf-bay-area", "silicon-valley", "san-diego"]) expect(geo.metroBySlug.has(slug)).toBe(true);
    expect(geo.cityBySlug.get("irvine-ca")?.metro).toBe("oc");
    expect(geo.cityBySlug.get("mountain-view-ca")?.metro).toBe("silicon-valley");
  });

  it("loads once and caches the index", async () => {
    expect(getGeo()).toBe(geo);
    expect(await loadGeo()).toBe(geo);
    expect(buildIndex(data).cities.length).toBe(geo.cities.length);
  });
});

describe("parseLocation", () => {
  const kinds = (text: string) => parseLocation(text, geo).map((s) => (s.kind === "city" ? `city:${s.slug}` : s.kind === "metro" ? `metro:${s.metro}` : s.kind === "state" ? `state:${s.state}` : s.kind === "remote" ? `remote:${s.country}` : s.kind));

  it.each([
    ["Irvine, CA", ["city:irvine-ca"]],
    ["Irvine, California, United States", ["city:irvine-ca"]],
    ["Irvine, CA 92618, USA", ["city:irvine-ca"]],
    ["Santa Monica, CA (Hybrid)", ["city:santa-monica-ca"]],
    ["Hybrid - Denver, CO", ["city:denver-co"]],
    ["New York, NY; Austin, TX", ["city:new-york-ny", "city:austin-tx"]],
    ["San Francisco, CA | Seattle, WA", ["city:san-francisco-ca", "city:seattle-wa"]],
    ["Boston, MA / Remote", ["city:boston-ma", "remote:null"]],
    ["Los Angeles, CA or Remote", ["city:los-angeles-ca", "remote:null"]],
    ["San Francisco, CA, New York, NY", ["city:san-francisco-ca", "city:new-york-ny"]],
    ["Austin, TX and 3 more", ["city:austin-tx"]],
    ["Seattle, WA (+2 others)", ["city:seattle-wa"]],
    ["Remote (US)", ["remote:US"]],
    ["Remote - United States", ["remote:US"]],
    ["Remote", ["remote:null"]],
    ["Remote (Canada)", ["remote:foreign"]],
    ["Remote - EMEA", ["remote:foreign"]],
    ["US Remote", ["remote:US"]],
    ["Remote in Texas", ["remote:US"]],
    ["London, UK", ["foreign"]],
    ["Toronto, ON", ["foreign"]],
    ["Bengaluru, India", ["foreign"]],
    ["United States", ["us"]],
    ["USA", ["us"]],
    ["California", ["state:CA"]],
    ["TX", ["state:TX"]],
    ["San Francisco Bay Area", ["metro:sf-bay-area"]],
    ["Greater Seattle Area", ["metro:seattle"]],
    ["Bay Area, CA", ["metro:sf-bay-area"]],
    ["NYC", ["city:new-york-ny"]],
    ["New York", ["metro:nyc"]],
    ["DC", ["metro:dc"]],
    ["Washington, D.C.", ["city:washington-dc"]],
    ["St. Louis, MO", ["city:st-louis-mo"]],
    ["Saint Louis, Missouri", ["city:st-louis-mo"]],
    ["Lake Forest, IL", ["city:lake-forest-il"]],
    ["Portland, OR", ["city:portland-or"]],
    ["US-CA-Irvine", ["city:irvine-ca"]],
    ["Multiple Locations", ["unknown"]],
    ["Springfield", ["unknown"]],
    ["Smalltown, ID", ["city:smalltown-id"]],
    ["", []],
  ])("%s", (text, expected) => {
    expect(kinds(text)).toEqual(expected);
  });

  it("marks a city the data doesn't list as unknown to the data", () => {
    const [seg] = parseLocation("Smalltown, ID", geo);
    expect(seg).toMatchObject({ kind: "city", known: false, state: "ID", metro: null });
  });
});

describe("matchLocation", () => {
  const status = (location: string, choices: string[], remoteJob = false) => matchLocation(location, choices, geo, { remoteJob }).status;

  it.each([
    // The acceptance cases from the spec.
    ["Irvine, CA", ["metro:oc"], "pass"],
    ["Irvine, CA", ["state:CA"], "pass"],
    ["Glendale, AZ", ["metro:la"], "fail"],
    ["Glendale, CA", ["metro:la"], "pass"],
    ["New York, NY; Austin, TX", ["metro:austin"], "pass"],
    ["Jersey City, NJ", ["metro:nyc"], "pass"],
    ["Remote (Canada)", ["remote-us"], "fail"],
    ["", ["metro:oc"], "unknown"],
    ["Boise, ID", ["state:ID"], "pass"],
    ["Boise, ID", ["city:boise-id"], "pass"],
    ["Meridian, ID", ["city:boise-id"], "fail"],
    ["Meridian, ID", ["metro:boise"], "pass"],
    // Remote
    ["Remote (US)", ["remote-us"], "pass"],
    ["Remote", ["remote-us"], "pass"],
    ["Remote (US)", ["metro:oc"], "fail"],
    ["Remote - EMEA", ["remote-us", "us"], "fail"],
    // Anywhere in the US
    ["Fargo, ND", ["us"], "pass"],
    ["London, UK", ["us"], "fail"],
    ["United States", ["us"], "pass"],
    ["United States", ["metro:oc"], "unknown"],
    // Metros that contain other metros
    ["Mountain View, CA", ["metro:sf-bay-area"], "pass"],
    ["San Francisco, CA", ["metro:silicon-valley"], "fail"],
    ["Bay Area", ["metro:silicon-valley"], "unknown"],
    ["Bay Area", ["metro:sf-bay-area"], "pass"],
    // States and metros
    ["California", ["metro:la"], "unknown"],
    ["California", ["metro:austin"], "fail"],
    ["Greater Seattle Area", ["state:WA"], "pass"],
    ["New York City area", ["state:NJ"], "pass"],
    ["Stamford, CT", ["metro:nyc"], "pass"],
    ["Arlington, VA", ["metro:dc"], "pass"],
    ["Arlington, TX", ["metro:dc"], "fail"],
    ["Arlington, TX", ["metro:dfw"], "pass"],
    // Unknown cities: unknown when a choice is in that state, fail otherwise
    ["Smalltown, CA", ["metro:la"], "unknown"],
    ["Smalltown, CA", ["metro:austin"], "fail"],
    ["Smalltown, CA", ["state:CA"], "pass"],
    // Never fail on text it can't read
    ["Multiple Locations", ["metro:oc"], "unknown"],
    ["Springfield", ["metro:oc"], "unknown"],
    ["Various", ["remote-us"], "unknown"],
    // Foreign places
    ["Toronto, ON", ["metro:nyc"], "fail"],
    ["London, UK", ["metro:nyc", "remote-us"], "fail"],
    // Only remote chosen: an office job fails
    ["Denver, CO", ["remote-us"], "fail"],
    // Any segment matching is enough
    ["Austin, TX or Remote", ["remote-us"], "pass"],
  ])("%s with %j -> %s", (location, choices, expected) => {
    expect(status(location, choices)).toBe(expected);
  });

  it("treats a remote job's listed places as where remote workers may be", () => {
    expect(status("United States", ["remote-us"], true)).toBe("pass");
    expect(status("Denver, CO", ["remote-us"], true)).toBe("pass");
    expect(status("Canada", ["remote-us"], true)).toBe("fail");
    expect(status("", ["remote-us"], true)).toBe("pass");
    expect(status("", ["metro:oc"], true)).toBe("fail");
  });

  it("explains a remote job outside the US, and an office job when only remote is chosen", () => {
    expect(matchLocation("Remote (Canada)", ["remote-us"], geo).detail).toBe("Remote outside the US.");
    expect(matchLocation("Denver, CO", ["remote-us"], geo).detail).toContain("Remote (US) is your only location");
  });

  it("says which of her locations a city is in", () => {
    expect(matchLocation("Irvine, CA", ["metro:oc"], geo).detail).toBe("Irvine, CA is in Orange County, one of your locations.");
  });
});

describe("searchPlaces", () => {
  const ids = (q: string) => searchPlaces(q, geo).map((s) => s.id);

  it("finds a metro by an alias", () => {
    expect(ids("Bay Area")[0]).toBe("metro:sf-bay-area");
    expect(ids("sf")[0]).toBe("metro:sf-bay-area");
    expect(ids("DMV")[0]).toBe("metro:dc");
    expect(ids("Twin Cities")[0]).toBe("metro:minneapolis");
    expect(ids("RTP")[0]).toBe("metro:raleigh-durham");
    expect(ids("DFW")[0]).toBe("metro:dfw");
    expect(ids("LA")[0]).toBe("metro:la");
  });

  it("ranks an exact name above prefixes, and shows a city's metro", () => {
    const [first] = searchPlaces("Irvine", geo);
    expect(first).toEqual({ id: "city:irvine-ca", kind: "city", label: "Irvine, CA", detail: "in Orange County" });
    expect(ids("Orange County")[0]).toBe("metro:oc");
    expect(ids("austin").slice(0, 2)).toEqual(["metro:austin", "city:austin-tx"]);
    expect(ids("California")).toContain("state:CA");
    expect(ids("ca")).toContain("state:CA");
  });

  it("filters by a typed state and returns at most 8", () => {
    expect(ids("Portland, ME")[0]).toBe("city:portland-me");
    expect(ids("Portland, OR")).not.toContain("city:portland-me");
    expect(searchPlaces("san", geo).length).toBeLessThanOrEqual(8);
    expect(searchPlaces("", geo)).toEqual([]);
  });

  it("matches word prefixes", () => {
    expect(ids("clara")).toContain("city:santa-clara-ca");
  });
});

describe("choices", () => {
  it("parses and labels every kind of choice", () => {
    expect(parseChoice("remote-us")).toEqual({ kind: "remote" });
    expect(parseChoice("us")).toEqual({ kind: "us" });
    expect(parseChoice("state:CA")).toEqual({ kind: "state", code: "CA" });
    expect(parseChoice("city:boise-id")).toEqual({ kind: "city", slug: "boise-id", state: "ID" });
    expect(parseChoice("nonsense")).toBeNull();
    expect(choiceLabel("metro:oc", geo)).toBe("Orange County");
    expect(choiceLabel("city:irvine-ca", geo)).toBe("Irvine, CA");
    expect(choiceLabel("city:smalltown-id", geo)).toBe("Smalltown, ID");
    expect(choiceLabel("state:TX", geo)).toBe("Texas");
    expect(choiceLabel("remote-us", null)).toBe("Remote (US)");
  });

  it("accepts free text only as City, ST with a real state", () => {
    expect(choiceFromText("Boise, ID", geo)).toBe("city:boise-id");
    expect(choiceFromText("Smalltown, Idaho", geo)).toBe("city:smalltown-id");
    expect(choiceFromText("Smalltown, ZZ", geo)).toBeNull();
    expect(choiceFromText("Smalltown", geo)).toBeNull();
  });
});
