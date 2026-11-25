import Decimal from "decimal.js";
import type { DecimalString } from "@fetha/contracts";
import type { LegValuation } from "../api";
import type { OptionLegModel } from "./option-pricing";

// A leaf module (no dependency on price-operation.ts or probability-of-profit.ts): both import
// `PricedLeg` and `payoffAt` from here instead of from each other, which is what keeps the two
// from forming a runtime import cycle.

// Exported for score's own max-loss computation (ADR-0014 Q46/Q13): score builds this same
// shape from an operation's legs priced at their entry premium rather than a fresh market
// price, then reuses computePayoffProfile (price-operation.ts) instead of re-deriving max loss.
export type PricedLeg = {
  valuation: LegValuation;
  strike: DecimalString | null;
  premiumPerUnit: Decimal;
  // ADR-0063: the series' own `priceFactor` (1 for a stock leg and for every equity option).
  // `strike` above stays in the series' quotation unit; only `payoffAt` below needs this, to
  // scale the intrinsic value it derives from `strike` back down to the same reais
  // `premiumPerUnit` is already on before the two are combined.
  priceFactor: Decimal;
  // The sigma and time to expiry behind an option leg's fair value, so the T+0 curve
  // (ADR-0077) values it with the same model; null for a stock leg and for an option leg
  // without a model value.
  model: OptionLegModel | null;
};

function sign(side: "buy" | "sell"): 1 | -1 {
  return side === "buy" ? 1 : -1;
}

// Exported for probability-of-profit.ts (ADR-0082): the profit region's sign probe is this
// same per-sample payoff, never a value re-derived from the rounded `PayoffPoint[]` samples.
export function payoffAt(legs: readonly PricedLeg[], underlying: Decimal): Decimal {
  return legs.reduce((acc, leg) => {
    const role = leg.valuation.leg.role;
    // `underlying` and `leg.strike` are both on the series' quotation unit; an option leg's
    // intrinsic value is scaled down to reais (ADR-0063) before it meets `premiumPerUnit`,
    // which is already on that scale. A stock leg's own price factor is always 1.
    const value =
      role === "stock"
        ? underlying
        : role === "call"
          ? Decimal.max(underlying.sub(leg.strike ?? "0"), 0).div(leg.priceFactor)
          : Decimal.max(new Decimal(leg.strike ?? "0").sub(underlying), 0).div(leg.priceFactor);
    const legSign = sign(leg.valuation.leg.side);
    const pnlPerUnit = value.sub(leg.premiumPerUnit).mul(legSign);
    return acc.add(pnlPerUnit.mul(leg.valuation.leg.quantity));
  }, new Decimal(0));
}
