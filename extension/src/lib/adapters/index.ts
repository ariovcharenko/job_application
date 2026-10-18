import type { AtsAdapter } from "./types";
import { ashbyAdapter } from "./ashby";
import { genericAdapter } from "./generic";
import { greenhouseAdapter } from "./greenhouse";
import { leverAdapter } from "./lever";
import { workdayAdapter } from "./workday";

const ADAPTERS: AtsAdapter[] = [greenhouseAdapter, leverAdapter, ashbyAdapter, workdayAdapter];

export function pickAdapter(location: Pick<Location, "hostname">): AtsAdapter {
  return ADAPTERS.find((a) => a.matches(location)) ?? genericAdapter;
}

export type { AtsAdapter };
