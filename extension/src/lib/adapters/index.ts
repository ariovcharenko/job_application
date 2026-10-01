import type { AtsAdapter } from "./types";
import { ashbyAdapter } from "./ashby";
import { genericAdapter } from "./generic";
import { greenhouseAdapter } from "./greenhouse";
import { leverAdapter } from "./lever";

const ADAPTERS: AtsAdapter[] = [greenhouseAdapter, leverAdapter, ashbyAdapter];

export function pickAdapter(location: Location): AtsAdapter {
  return ADAPTERS.find((a) => a.matches(location)) ?? genericAdapter;
}

export type { AtsAdapter };
