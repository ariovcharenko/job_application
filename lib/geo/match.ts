import { parseChoice, type LocationChoice } from "./choices";
import { metroCovers, metroStates, type GeoIndex } from "./index";
import { parseLocation, segmentLabel, type PlaceSegment } from "./parse";

// Is a posting's location one of her location choices? Pure and deterministic. A job passes if
// ANY place it lists matches ANY choice. Empty, unreadable or "Multiple locations" is unknown,
// never a fail; unknown is never a pass.

export type MatchStatus = "pass" | "fail" | "unknown";

export interface LocationMatch {
  status: MatchStatus;
  detail: string;
  /** True when it passed because it's remote (not because of a place). */
  remote: boolean;
  segments: PlaceSegment[];
}

interface SegmentResult {
  status: MatchStatus;
  detail: string;
  remote: boolean;
}

type PlaceChoice = Exclude<LocationChoice, { kind: "remote" }>;

function choiceStates(geo: GeoIndex, c: PlaceChoice): string[] {
  switch (c.kind) {
    case "state":
      return [c.code];
    case "metro":
      return metroStates(geo, c.slug);
    case "city":
      return [c.state];
    default:
      return [];
  }
}

const metroName = (geo: GeoIndex, slug: string) => geo.metroBySlug.get(slug)?.name ?? slug;
const stateName = (geo: GeoIndex, code: string) => geo.stateByCode.get(code)?.name ?? code;

function matchPlace(seg: Exclude<PlaceSegment, { kind: "remote" }>, places: PlaceChoice[], acceptsRemote: boolean, geo: GeoIndex): SegmentResult {
  const where = segmentLabel(seg, geo);
  const no = (detail: string): SegmentResult => ({ status: "fail", detail, remote: false });
  const maybe = (detail: string): SegmentResult => ({ status: "unknown", detail, remote: false });
  const yes = (detail: string): SegmentResult => ({ status: "pass", detail, remote: false });
  const outside = () =>
    no(places.length === 0 && acceptsRemote ? `${where} isn't remote, and Remote (US) is your only location.` : `${where} is outside your locations.`);

  if (seg.kind === "foreign") return no(`${seg.text} is outside the US.`);
  if (seg.kind === "unknown") return maybe(`Couldn't place "${seg.text}". Check the location yourself.`);
  if (places.length === 0) return outside();

  if (places.some((c) => c.kind === "us")) return yes(`${seg.kind === "us" ? "In the US" : where}, and you chose anywhere in the US.`);
  if (seg.kind === "us") return maybe("Somewhere in the US. The posting doesn't say where.");

  if (seg.kind === "city") {
    for (const c of places) {
      if (c.kind === "city" && c.slug === seg.slug) return yes(`${where} is one of your locations.`);
      if (c.kind === "metro" && metroCovers(geo, c.slug, seg.metro)) return yes(`${where} is in ${metroName(geo, c.slug)}, one of your locations.`);
      if (c.kind === "state" && c.code === seg.state) return yes(`${where} is in ${stateName(geo, c.code)}, one of your locations.`);
    }
    if (!seg.known && places.some((c) => choiceStates(geo, c).includes(seg.state))) {
      return maybe(`Not sure whether ${where} is in your locations.`);
    }
    return outside();
  }

  if (seg.kind === "state") {
    if (places.some((c) => c.kind === "state" && c.code === seg.state)) return yes(`In ${where}, one of your locations.`);
    if (places.some((c) => choiceStates(geo, c).includes(seg.state))) return maybe(`Somewhere in ${where}. The posting doesn't say where.`);
    return outside();
  }

  // A metro area.
  for (const c of places) {
    if (c.kind === "metro" && metroCovers(geo, c.slug, seg.metro)) return yes(`In ${where}, one of your locations.`);
    if (c.kind === "state" && metroStates(geo, seg.metro).includes(c.code)) return yes(`${where} includes ${stateName(geo, c.code)}, one of your locations.`);
  }
  const partly = places.some(
    (c) => (c.kind === "metro" && metroCovers(geo, seg.metro, c.slug)) || (c.kind === "city" && metroCovers(geo, seg.metro, geo.cityBySlug.get(c.slug)?.metro ?? null)),
  );
  if (partly) return maybe(`Somewhere in ${where}. Your locations cover only part of it.`);
  return outside();
}

function matchRemote(seg: Extract<PlaceSegment, { kind: "remote" }>, acceptsRemote: boolean): SegmentResult {
  if (seg.country === "foreign") return { status: "fail", detail: "Remote outside the US.", remote: true };
  if (!acceptsRemote) return { status: "fail", detail: "Remote, but Remote (US) isn't one of your locations.", remote: true };
  return { status: "pass", detail: "Remote in the US.", remote: true };
}

/**
 * Matches a posting's location text against her choices (Preferences.locations ids).
 * `remoteJob`: the posting is remote (its work mode), so each place it names is where remote
 * workers may live rather than an office.
 */
export function matchLocation(location: string, choices: string[], geo: GeoIndex, opts: { remoteJob?: boolean } = {}): LocationMatch {
  const parsed = choices.map(parseChoice).filter((c): c is LocationChoice => c !== null);
  const acceptsRemote = parsed.some((c) => c.kind === "remote");
  const places = parsed.filter((c): c is PlaceChoice => c.kind !== "remote");

  let segments = parseLocation(location, geo);
  if (opts.remoteJob) {
    segments = segments.length
      ? segments.map((s): PlaceSegment => (s.kind === "remote" ? s : { kind: "remote", country: s.kind === "foreign" ? "foreign" : s.kind === "unknown" ? null : "US", text: s.text }))
      : [{ kind: "remote", country: null, text: "Remote" }];
  }
  if (segments.length === 0) return { status: "unknown", detail: "Location not stated.", remote: false, segments };

  const results = segments.map((s) => (s.kind === "remote" ? matchRemote(s, acceptsRemote) : matchPlace(s, places, acceptsRemote, geo)));
  const pick = (status: MatchStatus) => results.find((r) => r.status === status);
  const best = pick("pass") ?? pick("unknown");
  if (best) return { ...best, segments };
  const fails = results.filter((r) => r.status === "fail");
  const detail = fails.length > 1 ? `None of its ${fails.length} locations are in your locations. ${fails[0].detail}` : fails[0].detail;
  return { status: "fail", detail, remote: fails.every((r) => r.remote), segments };
}
