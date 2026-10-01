import { aliasKey, normPlace, type GeoIndex } from "./index";

// Reads a posting's location text into places, deterministically. "Irvine, CA; Remote (US)"
// becomes a city and a remote segment. Anything it can't place is "unknown", never guessed.

export type PlaceSegment =
  | { kind: "remote"; country: "US" | "foreign" | null; text: string }
  | { kind: "city"; name: string; state: string; slug: string; metro: string | null; known: boolean; text: string }
  | { kind: "state"; state: string; text: string }
  | { kind: "metro"; metro: string; text: string }
  | { kind: "us"; text: string }
  | { kind: "foreign"; text: string }
  | { kind: "unknown"; text: string };

const US_NAMES = new Set([
  "us", "usa", "u s", "u s a", "united states", "united states of america", "the us", "the usa", "the united states", "america",
  "nationwide", "us based", "usa based", "us only", "usa only",
]);

/** State codes that, written alone, usually mean a metro: "LA" (not Louisiana), "DC". */
const METRO_FIRST_CODES = new Set(["LA", "DC"]);

const FOREIGN_PLACES = new Set(
  [
    "canada", "uk", "u k", "united kingdom", "great britain", "england", "scotland", "wales", "northern ireland", "ireland", "germany",
    "france", "spain", "portugal", "netherlands", "the netherlands", "poland", "india", "china", "japan", "singapore", "australia",
    "mexico", "brazil", "israel", "sweden", "switzerland", "italy", "romania", "ukraine", "philippines", "argentina", "colombia",
    "costa rica", "south korea", "korea", "taiwan", "hong kong", "vietnam", "egypt", "nigeria", "south africa", "kenya", "uae",
    "united arab emirates", "czech republic", "czechia", "hungary", "denmark", "norway", "finland", "belgium", "austria",
    "new zealand", "chile", "peru", "turkey", "serbia", "estonia", "lithuania", "latvia", "greece", "pakistan", "bangladesh",
    "indonesia", "malaysia", "thailand", "bulgaria", "croatia", "uruguay", "luxembourg", "saudi arabia", "qatar", "europe", "emea",
    "apac", "latam", "eu", "asia", "ontario", "british columbia", "quebec", "alberta", "manitoba", "saskatchewan", "nova scotia",
    "new brunswick", "newfoundland", "prince edward island", "worldwide", "global", "international",
  ].map(normPlace),
);

/** Big non-US job cities that are often written without a country. Also a US city in the data = ambiguous. */
const FOREIGN_CITIES = new Set(
  [
    "london", "toronto", "vancouver", "montreal", "ottawa", "calgary", "edmonton", "waterloo", "berlin", "munich", "hamburg", "paris",
    "amsterdam", "dublin", "bangalore", "bengaluru", "hyderabad", "pune", "mumbai", "chennai", "delhi", "new delhi", "gurgaon",
    "gurugram", "noida", "tel aviv", "tokyo", "sydney", "melbourne", "warsaw", "krakow", "madrid", "barcelona", "lisbon", "zurich",
    "stockholm", "copenhagen", "mexico city", "sao paulo", "buenos aires", "bogota", "manila", "seoul", "beijing", "shanghai",
    "shenzhen", "taipei", "cork", "edinburgh", "belfast", "prague", "bucharest", "kyiv", "vienna", "oslo", "helsinki",
  ].map(normPlace),
);

/** Two-letter codes that are Canadian provinces (never US states). */
const CA_PROVINCES = new Set(["ON", "BC", "QC", "AB", "MB", "SK", "NS", "NB", "NL", "PE", "YT", "NT", "NU"]);

/** Short names for a city, not a metro ("NYC" is the city of New York). */
const CITY_ALIASES: Record<string, string> = {
  nyc: "new-york-ny",
  "new york city": "new-york-ny",
  sf: "san-francisco-ca",
  "san fran": "san-francisco-ca",
  "washington dc": "washington-dc",
  "washington d c": "washington-dc",
  philly: "philadelphia-pa",
};

const MULTIPLE = /^(multiple|various|several|many|all)( us| u s)?( locations?| cities| offices| sites)?$|^(tbd|tba|n a|na|none|flexible|negotiable|see (description|posting)|location flexible)$/;
const WORK_MODE_WORDS = /\b(hybrid|on-?site|in[- ]office|in[- ]person|office[- ]based|onsite|in office)\b/gi;
const REMOTE_WORDS = /\b(fully remote|100% remote|remote[- ]first|remote|work from home|wfh|anywhere|distributed|telecommute|virtual)\b/i;

function resolveState(geo: GeoIndex, text: string): string | null {
  const n = normPlace(text);
  if (n.length === 2 && geo.stateByCode.has(n.toUpperCase())) return n.toUpperCase();
  return geo.stateByName.get(n) ?? null;
}

function cleanup(text: string): string {
  return text
    .replace(/\(\s*\)/g, " ")
    .replace(/[()[\]]/g, " ")
    .replace(/\b\d{5}(-\d{4})?\b/g, " ")
    .replace(/\s+,/g, ",")
    .replace(/,\s*,+/g, ",")
    .replace(/\s+/g, " ")
    .replace(/^[\s,:\-–—•·]+|[\s,:\-–—•·]+$/g, "")
    .trim();
}

function cityFromSlug(geo: GeoIndex, slug: string, text: string): PlaceSegment | null {
  const c = geo.cityBySlug.get(slug);
  return c ? { kind: "city", name: c.name, state: c.state, slug: c.slug, metro: c.metro, known: true, text } : null;
}

function singleMetro(geo: GeoIndex, text: string, inState?: string): string | null {
  const slugs = (geo.metroByAlias.get(aliasKey(text)) ?? []).filter((s) => !inState || geo.metroBySlug.get(s)!.states.includes(inState));
  return slugs.length === 1 ? slugs[0] : null;
}

/** One part with no comma: "Irvine", "Bay Area", "California", "CA", "Canada", "United States". */
function parseSingle(geo: GeoIndex, part: string, text: string): PlaceSegment {
  const n = normPlace(part);
  if (!n || MULTIPLE.test(n)) return { kind: "unknown", text };
  if (US_NAMES.has(n)) return { kind: "us", text };
  if (FOREIGN_PLACES.has(n)) return { kind: "foreign", text };
  const cities = geo.citiesByName.get(n) ?? [];
  if (FOREIGN_CITIES.has(n)) return cities.length ? { kind: "unknown", text } : { kind: "foreign", text };
  const code = part.trim();
  if (/^[A-Z]{2}$/.test(code) && geo.stateByCode.has(code)) {
    const metro = METRO_FIRST_CODES.has(code) ? singleMetro(geo, code) : null;
    return metro ? { kind: "metro", metro, text } : { kind: "state", state: code, text };
  }
  if (CITY_ALIASES[n]) return cityFromSlug(geo, CITY_ALIASES[n], text) ?? { kind: "unknown", text };
  const stateCode = geo.stateByName.get(n);
  if (cities.length === 1 && !stateCode) return cityFromSlug(geo, cities[0].slug, text)!;
  const metro = singleMetro(geo, part);
  if (metro) return { kind: "metro", metro, text };
  if (stateCode) return { kind: "state", state: stateCode, text };
  if (cities.length === 1) return cityFromSlug(geo, cities[0].slug, text)!;
  return { kind: "unknown", text };
}

/** A place with no remote wording. */
function parsePlace(geo: GeoIndex, raw: string, text: string): PlaceSegment {
  // Workday style: "US-CA-Irvine", "USA - California - Irvine".
  const workday = raw.match(/^\s*(?:US|USA)\s*-\s*([A-Za-z .]+?)\s*-\s*(.+)$/i);
  const s = cleanup((workday ? `${workday[2]}, ${workday[1]}` : raw).replace(WORK_MODE_WORDS, " "));
  let parts = s.split(",").map((p) => p.trim()).filter(Boolean);
  let sawUS = false;
  while (parts.length && US_NAMES.has(normPlace(parts[parts.length - 1]))) {
    parts = parts.slice(0, -1);
    sawUS = true;
  }
  if (parts.length === 0) return sawUS ? { kind: "us", text } : { kind: "unknown", text };
  if (parts.length === 1) return parseSingle(geo, parts[0], text);

  const last = parts[parts.length - 1];
  const lastNorm = normPlace(last);
  if (FOREIGN_PLACES.has(lastNorm) || CA_PROVINCES.has(last.toUpperCase())) return { kind: "foreign", text };
  const state = resolveState(geo, last);
  const cityPart = parts[parts.length - 2];
  if (state) {
    const cityNorm = normPlace(cityPart);
    if (MULTIPLE.test(cityNorm)) return { kind: "state", state, text };
    const alias = CITY_ALIASES[cityNorm];
    if (alias && alias.endsWith(`-${state.toLowerCase()}`)) return cityFromSlug(geo, alias, text) ?? { kind: "unknown", text };
    const city = geo.citiesByName.get(cityNorm)?.find((c) => c.state === state);
    if (city) return cityFromSlug(geo, city.slug, text)!;
    const metro = singleMetro(geo, cityPart, state);
    if (metro) return { kind: "metro", metro, text };
    if (!/[a-z]/i.test(cityPart)) return { kind: "state", state, text };
    return { kind: "city", name: cityPart, state, slug: `${cityNorm.replace(/ /g, "-")}-${state.toLowerCase()}`, metro: null, known: false, text };
  }
  // "Irvine, Orange County"
  const metro = singleMetro(geo, last);
  if (metro) {
    const m = geo.metroBySlug.get(metro)!;
    const city = geo.citiesByName.get(normPlace(cityPart))?.find((c) => m.states.includes(c.state));
    return city ? cityFromSlug(geo, city.slug, text)! : { kind: "metro", metro, text };
  }
  // Any other two-letter code that isn't a US state ("Berlin, DE" aside) is a foreign region.
  if (/^[A-Z]{2}$/.test(last)) return { kind: "foreign", text };
  if (FOREIGN_CITIES.has(normPlace(cityPart))) return { kind: "foreign", text };
  return { kind: "unknown", text };
}

function parseSegment(geo: GeoIndex, seg: string): PlaceSegment {
  const text = seg.trim();
  if (REMOTE_WORDS.test(text) && !/\bhybrid\b/i.test(text)) {
    const rest = cleanup(
      text
        .replace(new RegExp(REMOTE_WORDS.source, "gi"), " ")
        .replace(/\b(in|within|from|based|only|eligible|position|role|job|opportunity|friendly|ok|okay)\b/gi, " "),
    );
    if (!rest) return { kind: "remote", country: null, text };
    const where = parsePlace(geo, rest, rest);
    const country = where.kind === "foreign" ? "foreign" : where.kind === "unknown" ? null : "US";
    return { kind: "remote", country, text };
  }
  return parsePlace(geo, text, text);
}

/** Splits "City, ST, City, ST" (no other separator) into pairs. */
function splitCommaPairs(geo: GeoIndex, seg: string): string[] {
  const parts = seg.split(",").map((p) => p.trim());
  if (parts.length < 4 || parts.length % 2 !== 0) return [seg];
  for (let i = 1; i < parts.length; i += 2) if (!resolveState(geo, parts[i])) return [seg];
  const out: string[] = [];
  for (let i = 0; i < parts.length; i += 2) out.push(`${parts[i]}, ${parts[i + 1]}`);
  return out;
}

/** Every place a posting's location text names, in order. Empty text gives an empty list. */
export function parseLocation(raw: string, geo: GeoIndex): PlaceSegment[] {
  const text = (raw ?? "")
    .replace(/\(?\s*(\+|and\s+)\s*\d+\s+(more|others?)(\s+locations?)?\s*\)?/gi, " ")
    .replace(/\b\d+\s+locations?\b/gi, " ")
    .trim();
  if (!text) return [];
  return text
    .split(/\s*(?:;|\||\n|•|·|\s\/\s)\s*/)
    // Lowercase " or " only: ", OR" is Oregon.
    .flatMap((s) => s.split(/\s+or\s+/))
    .flatMap((s) => splitCommaPairs(geo, s))
    .map((s) => s.trim())
    .filter((s) => cleanup(s) !== "")
    .map((s) => parseSegment(geo, s));
}

/** How a parsed place reads in a sentence ("Irvine, CA", "California", "the SF Bay Area"). */
export function segmentLabel(seg: PlaceSegment, geo: GeoIndex): string {
  switch (seg.kind) {
    case "city":
      return `${seg.name}, ${seg.state}`;
    case "state":
      return geo.stateByCode.get(seg.state)?.name ?? seg.state;
    case "metro":
      return geo.metroBySlug.get(seg.metro)?.name ?? seg.metro;
    case "us":
      return "the US";
    case "remote":
      return "Remote";
    default:
      return seg.text;
  }
}
