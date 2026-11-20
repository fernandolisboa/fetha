import { Decimal } from "decimal.js";
import type { RiskProfile } from "@fetha/contracts";

// The risk profile's own per-operation cap, in centavos: the one place this ratio is turned into
// an absolute amount (round 1 review item 5 — no caller computes it again with a raw JS
// `number`). Sizing (`chooseLotSize`) and the plan screen's "share of your risk limit" both read
// this, so the two can never disagree about what the limit is.
export function riskLimitCentavos(riskProfile: RiskProfile): number {
  return new Decimal(riskProfile.declaredCapital)
    .mul(riskProfile.limits.maxLossPerOperation)
    .floor()
    .toNumber();
}
