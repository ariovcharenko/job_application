// Deprecated: the fixed regions from before database v4. Location choices and matching now live
// in lib/geo (metros, cities, states); old region names are migrated by lib/eligibility/migrate.ts.
// Kept for REGION_NAMES (free-text location suggestions), looksRemote and matchRegion, which other
// code still imports.

export interface Region {
  name: string;
  /** City / area names that count as being in the region. Matched case-insensitively. */
  places: string[];
}

export const REGIONS: Region[] = [
  {
    name: "Orange County, CA",
    places: [
      "orange county", "irvine", "anaheim", "santa ana", "costa mesa", "newport beach", "huntington beach",
      "fullerton", "mission viejo", "aliso viejo", "lake forest", "tustin", "garden grove", "laguna hills",
      "laguna beach", "laguna niguel", "brea", "yorba linda", "san clemente", "fountain valley", "buena park",
      "cypress", "westminster", "rancho santa margarita", "foothill ranch", "placentia", "seal beach", "la habra",
    ],
  },
  {
    name: "Los Angeles, CA",
    places: [
      "los angeles", "santa monica", "culver city", "pasadena", "burbank", "glendale", "el segundo", "long beach",
      "torrance", "beverly hills", "west hollywood", "hollywood", "playa vista", "marina del rey", "venice",
      "manhattan beach", "hawthorne", "inglewood", "santa clarita", "woodland hills", "sherman oaks", "encino",
      "van nuys", "downey", "el monte", "alhambra", "monrovia", "irwindale", "carson", "compton", "west la",
    ],
  },
  {
    name: "San Francisco Bay Area, CA",
    places: [
      "bay area", "san francisco", "oakland", "berkeley", "san jose", "palo alto", "mountain view", "sunnyvale",
      "santa clara", "cupertino", "menlo park", "redwood city", "san mateo", "foster city", "fremont", "milpitas",
      "los gatos", "los altos", "south san francisco", "emeryville", "walnut creek", "pleasanton", "san ramon",
      "hayward", "burlingame", "san bruno", "campbell", "saratoga", "santa cruz", "sausalito", "mill valley",
    ],
  },
  { name: "San Diego, CA", places: ["san diego", "la jolla", "carlsbad", "oceanside", "encinitas", "chula vista", "del mar"] },
  { name: "Sacramento, CA", places: ["sacramento", "folsom", "roseville", "rancho cordova"] },
  { name: "Seattle, WA", places: ["seattle", "bellevue", "redmond", "kirkland", "tacoma"] },
  { name: "New York, NY", places: ["new york", "nyc", "brooklyn", "manhattan", "queens", "jersey city", "hoboken"] },
  { name: "Austin, TX", places: ["austin", "round rock", "cedar park"] },
  { name: "Chicago, IL", places: ["chicago", "evanston", "schaumburg", "naperville", "oak brook"] },
  { name: "Boston, MA", places: ["boston", "cambridge, ma", "somerville", "waltham"] },
];

/** Suggestions for free-text location fields: big US job hubs, in no personal order. */
export const REGION_NAMES = [
  "New York, NY",
  "San Francisco, CA",
  "Seattle, WA",
  "Austin, TX",
  "Boston, MA",
  "Los Angeles, CA",
  "Chicago, IL",
  "Washington, DC",
  "Denver, CO",
  "Atlanta, GA",
  "Dallas, TX",
  "San Jose, CA",
  "San Diego, CA",
  "Raleigh, NC",
];

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Region a free-text location falls in ("Irvine, CA" -> "Orange County, CA"), or null if none matches. */
export function matchRegion(location: string): string | null {
  const text = location.toLowerCase();
  if (!text.trim()) return null;
  // An explicit two-letter state ("Glendale, AZ") must agree with the region's state.
  const stated = location.match(/,\s*([A-Z]{2})\b/)?.[1];
  const statedState = stated && stated !== "US" ? stated : null;
  for (const region of REGIONS) {
    if (statedState && region.name.slice(-2) !== statedState) continue;
    if (region.places.some((p) => new RegExp(`\\b${escape(p)}\\b`).test(text))) return region.name;
  }
  return null;
}

/** True if the text says the job is remote (as opposed to just mentioning a remote-friendly office). */
export function looksRemote(location: string): boolean {
  return /\bremote\b|work from home|\bwfh\b|\banywhere\b/i.test(location);
}
