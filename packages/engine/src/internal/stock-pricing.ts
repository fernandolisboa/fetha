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
import { priceLegsAtSpot } from "./price-operation";

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

// Each leg is priced at its own entryPrice (`source: "given"`); the caller's priceSource has
// no LegInput field, so it is restored after pricing.
export function priceStockLegs(input: PriceStockLegsInput): Result<OperationPricing> {
  const legs: LegInput[] = input.legs.map((leg) => ({
    role: leg.role,
    side: leg.side,
    ticker: leg.ticker,
    quantity: leg.quantity,
    price: leg.entryPrice,
  }));

  const priced = priceLegsAtSpot(
    input.view,
    input.at,
    input.underlying,
    input.spot,
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
          "priceStockLegs: priceLegsAtSpot returned a different number of legs",
        );
        return { ...valuation, leg: stockLeg, priceSource: stockLeg.priceSource };
      }),
    },
  };
}
