import type { SessionDate } from "@fetha/contracts";
import type { LegRole } from "@fetha/engine";

export interface LegExpiry {
  role: LegRole;
  expiry: SessionDate | null;
}

// Horizon default (decisions brief, item 4; ADR-0014 Q43 "single expiry per
// structure"): every option leg of a structure shares one expiry, so the
// first option leg's expiry is the structure's. A stock-only leg set has no
// option leg and therefore no default; the caller must ask the user to pick
// a horizon by hand. `expiry` is `null` when the caller could not resolve an
// option leg's series (a data gap), which is also "no default" here.
export function deriveDefaultHorizon(legs: readonly LegExpiry[]): SessionDate | null {
  const optionLeg = legs.find((leg) => leg.role !== "stock");
  return optionLeg?.expiry ?? null;
}
