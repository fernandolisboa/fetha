import { Decimal } from "decimal.js";
import type { RiskProfile } from "@fetha/contracts";

// The risk profile's own per-operation cap, in centavos: the one place this ratio is turned into
// an absolute amount (round 1 review item 5 — no caller computes it again with a raw JS
// `number`). `plans`' sizing and plan screen, and `learning`'s position-sizing placeholders, both
// read this, so none of them can disagree about what the limit is. Lives here, not in `plans`,
// since `portfolio` already owns the risk profile and `learning` cannot import `plans` (`plans`
// itself depends on `learning`).
export function riskLimitCentavos(riskProfile: RiskProfile): number {
  return new Decimal(riskProfile.declaredCapital)
    .mul(riskProfile.limits.maxLossPerOperation)
    .floor()
    .toNumber();
}
