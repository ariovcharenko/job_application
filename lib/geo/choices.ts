import { citySlug, normPlace, type GeoIndex } from "./index";

// A location choice is stored as a short id in Preferences.locations:
//   "remote-us"     remote jobs open to people in the US
//   "us"            anywhere in the US (hybrid / on-site)
//   "state:CA"      anywhere in a state
//   "metro:la"      a metro area (lib/geo/usPlaces.ts METROS)
//   "city:boise-id" one city (it may be a city the data doesn't list, typed as "City, ST")

export const REMOTE_US = "remote-us";
export const ANYWHERE_US = "us";

export type LocationChoice =
  | { kind: "remote" }
  | { kind: "us" }
  | { kind: "state"; code: string }
  | { kind: "metro"; slug: string }
  | { kind: "city"; slug: string; state: string };

export function parseChoice(id: string): LocationChoice | null {
  if (id === REMOTE_US) return { kind: "remote" };
  if (id === ANYWHERE_US) return { kind: "us" };
  const [prefix, rest] = [id.slice(0, id.indexOf(":")), id.slice(id.indexOf(":") + 1)];
  if (!rest || id.indexOf(":") < 0) return null;
  if (prefix === "state" && /^[A-Z]{2}$/.test(rest)) return { kind: "state", code: rest };
  if (prefix === "metro") return { kind: "metro", slug: rest };
  if (prefix === "city") {
    const m = rest.match(/-([a-z]{2})$/);
    return m ? { kind: "city", slug: rest, state: m[1].toUpperCase() } : null;
  }
  return null;
}

export const stateChoice = (code: string) => `state:${code}`;
export const metroChoice = (slug: string) => `metro:${slug}`;
export const cityChoice = (slug: string) => `city:${slug}`;

const titleCase = (s: string) => s.replace(/\b[a-z]/g, (c) => c.toUpperCase());

/** How a choice reads in the UI ("Orange County", "Irvine, CA", "California", "Remote (US)"). */
export function choiceLabel(id: string, geo: GeoIndex | null): string {
  const c = parseChoice(id);
  if (!c) return id;
  switch (c.kind) {
    case "remote":
      return "Remote (US)";
    case "us":
      return "Anywhere in the US";
    case "state":
      return geo?.stateByCode.get(c.code)?.name ?? c.code;
    case "metro":
      return geo?.metroBySlug.get(c.slug)?.name ?? titleCase(c.slug.replace(/-/g, " "));
    case "city": {
      const city = geo?.cityBySlug.get(c.slug);
      if (city) return `${city.name}, ${city.state}`;
      return `${titleCase(c.slug.slice(0, -3).replace(/-/g, " "))}, ${c.state}`;
    }
  }
}

/**
 * Free text typed into the location picker, accepted only as "City, ST" with a real state
 * (code or name). Returns the city choice id, or null.
 */
export function choiceFromText(text: string, geo: GeoIndex): string | null {
  const parts = text.split(",").map((p) => p.trim());
  if (parts.length !== 2 || !parts[0] || !/[a-z]/i.test(parts[0])) return null;
  const rawState = parts[1];
  const code = /^[A-Za-z]{2}$/.test(rawState) && geo.stateByCode.has(rawState.toUpperCase()) ? rawState.toUpperCase() : geo.stateByName.get(normPlace(rawState));
  if (!code) return null;
  const known = geo.citiesByName.get(normPlace(parts[0]))?.find((c) => c.state === code);
  return cityChoice(known?.slug ?? citySlug(parts[0], code));
}
