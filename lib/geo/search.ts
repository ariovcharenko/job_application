import { cityChoice, metroChoice, stateChoice } from "./choices";
import { normPlace, type GeoIndex } from "./index";

// Type-ahead for the location picker. Ranked exact > prefix > word-prefix > alias, then metros
// before cities before states, then by the data file's order (bigger places first).

export type PlaceKind = "metro" | "city" | "state";

export interface PlaceSuggestion {
  /** The id stored in Preferences.locations. */
  id: string;
  kind: PlaceKind;
  label: string;
  /** "in Orange County" for a city, the states for a metro. */
  detail?: string;
}

const EXACT = 0;
const PREFIX = 1;
const WORD_PREFIX = 2;
const ALIAS = 3;
const NONE = 9;

/** How well `name` answers the query `q` (both normalized). */
function rankName(name: string, q: string): number {
  if (name === q) return EXACT;
  if (name.startsWith(q)) return PREFIX;
  if (name.split(" ").some((w, i, words) => i > 0 && words.slice(i).join(" ").startsWith(q))) return WORD_PREFIX;
  return NONE;
}

/** Aliases count only by exact match ("SF", "DMV") or prefix, and rank below names except when exact. */
function rankAlias(aliases: string[], q: string): number {
  let best = NONE;
  for (const a of aliases) {
    const n = normPlace(a);
    if (n === q) return EXACT;
    if (n.startsWith(q) || rankName(n, q) === WORD_PREFIX) best = ALIAS;
  }
  return best;
}

const KIND_ORDER: Record<PlaceKind, number> = { metro: 0, city: 1, state: 2 };

export function searchPlaces(query: string, geo: GeoIndex, limit = 8): PlaceSuggestion[] {
  const [rawName, rawState] = query.split(",");
  const q = normPlace(rawName ?? "");
  const stateQ = normPlace(rawState ?? "");
  if (!q) return [];

  const hits: { s: PlaceSuggestion; rank: number; order: number }[] = [];
  const stateMatches = (code: string) =>
    !stateQ || code.toLowerCase() === stateQ || normPlace(geo.stateByCode.get(code)?.name ?? "").startsWith(stateQ);

  for (const m of geo.metros) {
    if (rawState !== undefined && !m.states.some(stateMatches)) continue;
    const rank = Math.min(rankName(normPlace(m.name), q), rankAlias(m.aliases, q));
    if (rank < NONE) hits.push({ s: { id: metroChoice(m.slug), kind: "metro", label: m.name, detail: `Metro area · ${m.states.join(", ")}` }, rank, order: m.rank });
  }
  for (const c of geo.cities) {
    if (!stateMatches(c.state)) continue;
    const rank = rankName(normPlace(c.name), q);
    if (rank === NONE) continue;
    const metro = c.metro ? geo.metroBySlug.get(c.metro) : undefined;
    hits.push({ s: { id: cityChoice(c.slug), kind: "city", label: `${c.name}, ${c.state}`, detail: metro ? `in ${metro.name}` : undefined }, rank, order: c.rank });
  }
  if (rawState === undefined) {
    geo.states.forEach((st, i) => {
      const byCode = q === st.code.toLowerCase() ? EXACT : NONE;
      const aliases = [...geo.stateByName.entries()].filter(([name, code]) => code === st.code && name !== normPlace(st.name)).map(([name]) => name);
      const rank = Math.min(byCode, rankName(normPlace(st.name), q), rankAlias(aliases, q));
      if (rank < NONE) hits.push({ s: { id: stateChoice(st.code), kind: "state", label: st.name, detail: "State" }, rank, order: i });
    });
  }

  return hits
    .sort((a, b) => a.rank - b.rank || KIND_ORDER[a.s.kind] - KIND_ORDER[b.s.kind] || a.order - b.order)
    .slice(0, limit)
    .map((h) => h.s);
}
