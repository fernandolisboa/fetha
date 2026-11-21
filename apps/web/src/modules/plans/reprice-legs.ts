import { decimalStringSchema, type Instant, type RiskProfile } from "@fetha/contracts";
import { engine, type LegInput, type MarketView, type OperationPricing } from "@fetha/engine";

import { limitPriceForLeg } from "./limit-price";
import type { LotPricing } from "./generate-plan";

const DEFAULT_TOLERANCE = decimalStringSchema.parse("0.010000");

// The second rung of the two-rung pricing (ADR-0079): given a probe already priced at the
// market's own last price, reprice the same legs with each leg's own limit price given
// explicitly, so the numbers a plan reports can never be beaten by a limit fill. Split out from
// `priceExactLegs` so a caller that already holds a probe (the auto-sized path's own
// `legSelectionFor` call) does not pay for a second, redundant probe.
export async function priceFromProbe(
  view: MarketView,
  at: Instant,
  probe: OperationPricing,
  riskProfile: RiskProfile,
  openOperationCount: number,
): Promise<LotPricing | null> {
  const finalLegs: LegInput[] = probe.legs.map((valuation) => ({
    role: valuation.leg.role,
    side: valuation.leg.side,
    ticker: valuation.leg.ticker,
    quantity: valuation.leg.quantity,
    price: limitPriceForLeg(
      valuation.leg.side,
      valuation.price ?? decimalStringSchema.parse("0.000000"),
      DEFAULT_TOLERANCE,
    ),
  }));
  const priced = await engine.priceOperation({
    view,
    at,
    legs: finalLegs,
    riskProfile,
    openOperationCount,
  });
  if (!priced.ok) return null;
  return { probe, final: priced.value };
}

// One set of legs' two-rung pricing (ADR-0079; factored out for ticket #380 so the auto-sized
// path (`legSelectionFor`'s own resolved legs) and the drag-to-adjust path (the user's own
// chosen legs) share one implementation): a probe at the market's own last price (also where a
// stale or untraded leg is caught), then `priceFromProbe`'s given-price rung.
export async function priceExactLegs(
  view: MarketView,
  at: Instant,
  legs: readonly LegInput[],
  riskProfile: RiskProfile,
  openOperationCount: number,
): Promise<LotPricing | null> {
  const probed = await engine.priceOperation({
    view,
    at,
    legs: [...legs],
    riskProfile,
    openOperationCount,
  });
  if (!probed.ok) return null;
  return priceFromProbe(view, at, probed.value, riskProfile, openOperationCount);
}
