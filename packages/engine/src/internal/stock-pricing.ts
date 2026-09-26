import type { Instant, DecimalString, RiskProfile, Ticker } from "@fetha/contracts";
import type {
  LegInput,
  MarketView,
  OperationLeg,
  OperationPricing,
  PriceSource,
  Provenance,
  Result,
} from "../api";
import { assertDefined } from "./invariant";
import { resolveDividendYield, resolveRiskFreeRate } from "./rates";
import { priceConcreteLegs } from "./price-operation";

export type StockLegInput = OperationLeg & { priceSource: PriceSource };

export type PriceStockLegsInput = {
  at: Instant;
  underlying: Ticker;
  spot: DecimalString;
  legs: readonly StockLegInput[];
  view: MarketView;
  riskProfile?: RiskProfile | undefined;
  openOperationCount?: number | undefined;
  provenanceBase: Pick<
    Provenance,
    "engineVersion" | "pricingModel" | "dataVersion" | "datasetNotes"
  >;
};

// One pricing path for stock and option proposals (#54). Each leg is priced at its own
// entryPrice (`source: "given"`); the caller's priceSource has no LegInput field, so it is
// restored after pricing.
export function priceStockLegs(input: PriceStockLegsInput): Result<OperationPricing> {
  const riskFreeRateResolution = resolveRiskFreeRate(input.view.macro, input.at);
  // ADR-0013's rates addendum applies the same rule to a stock leg's rate resolution as
  // to an option leg's: an annualRate/annualYield at or below -1 is invalid_input before
  // conversion, never a silent zero default (PR #53 round 4 item 3; superseding round 3
  // item 8's note-only fix).
  if (!riskFreeRateResolution.ok) return { ok: false, error: riskFreeRateResolution.error };
  const riskFreeRate = riskFreeRateResolution.value;

  const dividendResolution = resolveDividendYield(
    input.view.dividendYields,
    input.underlying,
    input.at,
  );
  if (!dividendResolution.ok) return { ok: false, error: dividendResolution.error };
  const dividendYield = dividendResolution.value;

  const rateNotes = [...riskFreeRateResolution.notes, ...dividendResolution.notes];

  const legs: LegInput[] = input.legs.map((leg) => ({
    role: leg.role,
    side: leg.side,
    ticker: leg.ticker,
    quantity: leg.quantity,
    price: leg.entryPrice,
  }));

  const priced = priceConcreteLegs(
    input.view,
    input.at,
    input.underlying,
    input.spot,
    riskFreeRate,
    dividendYield,
    rateNotes,
    legs,
    input.riskProfile,
    input.openOperationCount,
    input.provenanceBase,
  );
  if (!priced.ok) return priced;

  return {
    ok: true,
    value: {
      ...priced.value,
      legs: priced.value.legs.map((valuation, index) => {
        const stockLeg = assertDefined(
          input.legs[index],
          "priceStockLegs: priceConcreteLegs returned a different number of legs",
        );
        return { ...valuation, leg: stockLeg, priceSource: stockLeg.priceSource };
      }),
    },
  };
}
