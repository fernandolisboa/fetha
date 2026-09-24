import type { SessionDate } from "@fetha/contracts";
import type { LegRole } from "@fetha/engine";

import type { Database } from "@/db/client";
import { expiryByTicker } from "@/modules/market-data";

import { deriveDefaultHorizon } from "./horizon";

export interface HorizonLeg {
  role: LegRole;
  ticker: string;
}

// The impure half of the horizon default (brief item 4): resolves each
// option leg's ticker to its listed expiry through market-data, then hands
// the pure `deriveDefaultHorizon` the shared expiry to pick. Stock legs are
// never looked up (their `role` already says they carry no expiry).
export async function resolveDefaultHorizon(
  db: Database,
  legs: readonly HorizonLeg[],
): Promise<SessionDate | null> {
  const optionTickers = legs.filter((leg) => leg.role !== "stock").map((leg) => leg.ticker);
  const expiries = await expiryByTicker(db, optionTickers);

  return deriveDefaultHorizon(
    legs.map((leg) => ({ role: leg.role, expiry: expiries.get(leg.ticker) ?? null })),
  );
}
