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

// A thin adapter over `priceConcreteLegs` (#54): a stock-only proposal has no strike or
// expiry selection to do, but once it has an explicit spot and each leg's own entry price it
// is exactly the concrete-legs pricing pass `priceOperation` already runs, so the risk-limit
// checks, the max-loss/max-gain sign logic, the three-point-plus-strike-plus-break-even
// payoff sampling and the aggregate greeks all come from that one implementation now, not a
// second copy of it that had already diverged (break-evens for two or more stock legs).
//
// `priceConcreteLegs` resolves each leg's price through the same mid/last/close/average
// ladder `priceOperation` uses; giving it every leg's own `entryPrice` as `LegInput.price`
// makes that ladder return exactly that price with `source: "given"`, deterministically,
// with no dependency on `view.quotes`/`view.candles` for the ticker (`priceStockLegs`'s own
// callers, unlike `priceOperation`'s, already know the price they want priced — a fresh
// `evaluateStrategy` entry at the session's own close, an existing operation's own fill —
// and expect it priced exactly, not rediscovered). `StockLegInput.priceSource` is the
// caller's own record of where that price came from, not something `priceConcreteLegs` can
// derive from a price it never had to look up; it is restored onto each `LegValuation`
// (`leg` and `priceSource`) after pricing, the one piece of this shape `priceConcreteLegs`'s
// `LegInput`/`Leg` types have no field for.
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
