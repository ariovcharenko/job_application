import type { MetroRow, StateRow } from "./usPlaces";

// The place index built from lib/geo/usPlaces.ts. The data module is imported lazily
// (`loadGeo`), so it stays out of the first page's bundle; everything that needs it either awaits
// `loadGeo()` or takes a GeoIndex argument (pure, for tests).

export interface GeoState {
  code: string;
  name: string;
}

export interface GeoMetro {
  slug: string;
  name: string;
  states: string[];
  /** Metros inside this one (choosing this one covers their cities). */
  includes: string[];
  /** Order in the data file: bigger / more asked-for metros come first. */
  rank: number;
  aliases: string[];
}

export interface GeoCity {
  /** "irvine-ca" (the part after "city:" in a location choice). */
  slug: string;
  name: string;
  state: string;
  metro: string | null;
  rank: number;
}

export interface GeoIndex {
  states: GeoState[];
  stateByCode: Map<string, GeoState>;
  /** Normalized name or alias -> code. */
  stateByName: Map<string, string>;
  metros: GeoMetro[];
  metroBySlug: Map<string, GeoMetro>;
  /** Normalized alias key (see aliasKey) -> metro slugs. */
  metroByAlias: Map<string, string[]>;
  cities: GeoCity[];
  cityBySlug: Map<string, GeoCity>;
  /** Normalized city name -> every city with that name. */
  citiesByName: Map<string, GeoCity[]>;
}

/** Lowercase, no accents or periods, "Saint"/"Ft."/"Mt." spelled one way, single spaces. */
export function normPlace(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[.’']/g, "")
    .replace(/\bsaint\b/g, "st")
    .replace(/\bft\b/g, "fort")
    .replace(/\bmt\b/g, "mount")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** A metro alias with "greater", "area", "metro" and the like dropped, so "Greater Seattle Area" = "Seattle". */
export function aliasKey(s: string): string {
  return normPlace(s)
    .replace(/^(the )?greater /, "")
    .replace(/ (metropolitan|metro)( area| region)?$/, "")
    .replace(/ (area|region)$/, "")
    .trim();
}

/** "Irvine", "CA" -> "irvine-ca". */
export function citySlug(name: string, state: string): string {
  return `${normPlace(name).replace(/ /g, "-")}-${state.toLowerCase()}`;
}

export function buildIndex(data: { STATES: StateRow[]; METROS: MetroRow[]; OTHER_CITIES: Record<string, string> }): GeoIndex {
  const states = data.STATES.map(([code, name]) => ({ code, name }));
  const stateByCode = new Map(states.map((s) => [s.code, s]));
  const stateByName = new Map<string, string>();
  for (const [code, name, aliases = []] of data.STATES) {
    for (const n of [name, ...aliases]) stateByName.set(normPlace(n), code);
  }

  const metros: GeoMetro[] = [];
  const metroBySlug = new Map<string, GeoMetro>();
  const metroByAlias = new Map<string, string[]>();
  const cities: GeoCity[] = [];
  const cityBySlug = new Map<string, GeoCity>();
  const citiesByName = new Map<string, GeoCity[]>();

  const addCity = (name: string, state: string, metro: string | null) => {
    const slug = citySlug(name, state);
    if (!name.trim() || cityBySlug.has(slug)) return;
    const city: GeoCity = { slug, name, state, metro, rank: cities.length };
    cities.push(city);
    cityBySlug.set(slug, city);
    const key = normPlace(name);
    citiesByName.set(key, [...(citiesByName.get(key) ?? []), city]);
  };

  data.METROS.forEach((m, rank) => {
    const metro: GeoMetro = { slug: m.slug, name: m.name, states: m.states, includes: m.includes ?? [], rank, aliases: m.aliases ?? [] };
    metros.push(metro);
    metroBySlug.set(m.slug, metro);
    for (const a of [m.name, ...(m.aliases ?? [])]) {
      const key = aliasKey(a);
      const list = metroByAlias.get(key) ?? [];
      if (!list.includes(m.slug)) metroByAlias.set(key, [...list, m.slug]);
    }
    for (const [state, list] of Object.entries(m.cities)) {
      for (const name of list.split(",")) addCity(name.trim(), state, m.slug);
    }
  });
  for (const [state, list] of Object.entries(data.OTHER_CITIES)) {
    for (const name of list.split(",")) addCity(name.trim(), state, null);
  }

  return { states, stateByCode, stateByName, metros, metroBySlug, metroByAlias, cities, cityBySlug, citiesByName };
}

let cache: GeoIndex | null = null;
let pending: Promise<GeoIndex> | null = null;

/** The index if it has been loaded already, else null. */
export function getGeo(): GeoIndex | null {
  return cache;
}

/** Loads the place data (once) and builds the index. */
export function loadGeo(): Promise<GeoIndex> {
  if (cache) return Promise.resolve(cache);
  pending ??= import("./usPlaces").then((m) => {
    cache = buildIndex(m);
    return cache;
  });
  return pending;
}

/** Whether metro `outer` is `inner` or contains it. */
export function metroCovers(geo: GeoIndex, outer: string, inner: string | null): boolean {
  if (!inner) return false;
  if (outer === inner) return true;
  const m = geo.metroBySlug.get(outer);
  return !!m && m.includes.some((sub) => metroCovers(geo, sub, inner));
}

/** Every state a metro spans, including metros inside it. */
export function metroStates(geo: GeoIndex, slug: string): string[] {
  const m = geo.metroBySlug.get(slug);
  if (!m) return [];
  return Array.from(new Set([...m.states, ...m.includes.flatMap((s) => metroStates(geo, s))]));
}
