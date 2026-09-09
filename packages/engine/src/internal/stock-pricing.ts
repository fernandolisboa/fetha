import Decimal from "decimal.js";
import type { Centavos, DecimalString, Instant, RiskProfile, Ticker } from "@fetha/contracts";
import type {
  Greeks,
  LegValuation,
  LimitBreach,
  MarketView,
  Note,
  OperationLeg,
  OperationPricing,
  PayoffPoint,
  PriceSource,
  Provenance,
} from "../api";
import {
  CENTAVOS_PER_REAL,
  parseDecimal,
  PRICE_SCALE,
  RATIO_SCALE,
  toDecimalString,
} from "./decimal";
import { compareInstants } from "./instant";
import { toCentavos } from "./scalars";

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

const zero = toDecimalString(new Decimal(0), RATIO_SCALE);
const zeroGreeks: Greeks = {
  delta: zero,
  gamma: zero,
  theta: zero,
  vega: zero,
  rho: zero,
};

function latestVisible<T extends { asOf: Instant }>(rows: readonly T[], at: Instant): T | null {
  let latest: T | null = null;
  for (const row of rows) {
    if (compareInstants(row.asOf, at) > 0) continue;
    if (latest === null || compareInstants(row.asOf, latest.asOf) > 0) latest = row;
  }
  return latest;
}

function sign(side: OperationLeg["side"]): 1 | -1 {
  return side === "buy" ? 1 : -1;
}

export function priceStockLegs(input: PriceStockLegsInput): OperationPricing {
  const notes: Note[] = [];

  const cdiPoint = latestVisible(
    input.view.macro.filter((m) => m.series === "cdi"),
    input.at,
  );
  const riskFreeRate = cdiPoint
    ? toDecimalString(new Decimal(1).add(parseDecimal(cdiPoint.annualRate)).ln(), RATIO_SCALE)
    : toDecimalString(new Decimal(0), RATIO_SCALE);

  const dividendPoint = latestVisible(
    input.view.dividendYields.filter((d) => d.underlying === input.underlying),
    input.at,
  );
  const dividendYield = dividendPoint
    ? toDecimalString(new Decimal(1).add(parseDecimal(dividendPoint.annualYield)).ln(), RATIO_SCALE)
    : toDecimalString(new Decimal(0), RATIO_SCALE);
  if (!dividendPoint)
    notes.push({
      code: "dividend_yield_defaulted",
      message: "no dividend yield visible; defaulted to 0",
    });

  const legValuations: LegValuation[] = input.legs.map((leg) => ({
    leg,
    price: leg.entryPrice,
    priceSource: leg.priceSource,
    stale: null,
    fairValue: null,
    impliedVolatility: null,
    volatilitySource: null,
    greeks: { ...zeroGreeks, delta: toDecimalString(new Decimal(1), RATIO_SCALE) },
    timeToExpiryYears: null,
    notes: [],
  }));

  const netPremiumCentavos = input.legs.reduce(
    (acc, leg) =>
      acc.add(
        new Decimal(sign(leg.side))
          .neg()
          .mul(parseDecimal(leg.entryPrice).mul(CENTAVOS_PER_REAL))
          .mul(leg.quantity),
      ),
    new Decimal(0),
  );

  const netSlope = input.legs.reduce((acc, leg) => acc + sign(leg.side) * leg.quantity, 0);
  // The payoff of a net stock position as the underlying goes to zero is exactly the negative
  // of what was paid to enter it: a long leg loses everything paid, a short leg keeps everything
  // received, so this is the same figure as the net premium, not a separate computation.
  const payoffAtZeroCentavos = netPremiumCentavos;

  let maxLoss: Centavos | "unbounded";
  let maxGain: Centavos | "unbounded";
  if (netSlope > 0) {
    maxGain = "unbounded";
    maxLoss = toCentavos(
      payoffAtZeroCentavos.isNegative() ? payoffAtZeroCentavos.neg().round().toNumber() : 0,
    );
  } else if (netSlope < 0) {
    maxLoss = "unbounded";
    maxGain = toCentavos(
      payoffAtZeroCentavos.isPositive() ? payoffAtZeroCentavos.round().toNumber() : 0,
    );
  } else {
    maxLoss = toCentavos(
      payoffAtZeroCentavos.isNegative() ? payoffAtZeroCentavos.neg().round().toNumber() : 0,
    );
    maxGain = toCentavos(
      payoffAtZeroCentavos.isPositive() ? payoffAtZeroCentavos.round().toNumber() : 0,
    );
  }

  const [soleLeg] = input.legs;
  const breakEvens: DecimalString[] =
    input.legs.length === 1 && soleLeg
      ? [toDecimalString(parseDecimal(soleLeg.entryPrice), PRICE_SCALE)]
      : [];

  const spot = input.spot;
  const payoff: PayoffPoint[] = [0.8, 1, 1.2].map((factor) => {
    const underlying = parseDecimal(spot).mul(factor);
    const pnlCentavos = input.legs.reduce(
      (acc, leg) =>
        acc.add(
          new Decimal(sign(leg.side))
            .mul(underlying.sub(parseDecimal(leg.entryPrice)))
            .mul(CENTAVOS_PER_REAL)
            .mul(leg.quantity),
        ),
      new Decimal(0),
    );
    return {
      underlying: toDecimalString(underlying, PRICE_SCALE),
      pnl: toCentavos(pnlCentavos.round().toNumber()),
    };
  });

  const greeks: Greeks = {
    ...zeroGreeks,
    delta: toDecimalString(new Decimal(netSlope), RATIO_SCALE),
  };

  const limitBreaches: LimitBreach[] = [];
  if (!input.riskProfile) {
    notes.push({
      code: "no_risk_profile",
      message: "no risk profile supplied; limits not checked",
    });
  } else {
    const capital = new Decimal(input.riskProfile.declaredCapital);
    if (maxLoss !== "unbounded" && capital.gt(0)) {
      const ratio = new Decimal(maxLoss).div(capital);
      const allowed = parseDecimal(input.riskProfile.limits.maxLossPerOperation);
      if (ratio.gt(allowed)) {
        limitBreaches.push({
          limit: "maxLossPerOperation",
          value: toDecimalString(ratio, RATIO_SCALE),
          allowed: input.riskProfile.limits.maxLossPerOperation,
        });
      }
    }
    const notionalCentavos = input.legs.reduce(
      (acc, leg) => acc.add(parseDecimal(leg.entryPrice).mul(CENTAVOS_PER_REAL).mul(leg.quantity)),
      new Decimal(0),
    );
    if (capital.gt(0)) {
      const exposureRatio = notionalCentavos.div(capital);
      const allowedExposure = parseDecimal(input.riskProfile.limits.maxExposurePerOperation);
      if (exposureRatio.gt(allowedExposure)) {
        limitBreaches.push({
          limit: "maxExposurePerOperation",
          value: toDecimalString(exposureRatio, RATIO_SCALE),
          allowed: input.riskProfile.limits.maxExposurePerOperation,
        });
      }
    }
    if (capital.gt(0) && netPremiumCentavos.isNegative()) {
      const premiumRatio = netPremiumCentavos.neg().div(capital);
      const allowedPremium = parseDecimal(input.riskProfile.limits.maxPremiumBought);
      if (premiumRatio.gt(allowedPremium)) {
        limitBreaches.push({
          limit: "maxPremiumBought",
          value: toDecimalString(premiumRatio, RATIO_SCALE),
          allowed: input.riskProfile.limits.maxPremiumBought,
        });
      }
    }
    const openCount = input.openOperationCount ?? 0;
    if (openCount + 1 > input.riskProfile.limits.maxOpenOperations) {
      limitBreaches.push({
        limit: "maxOpenOperations",
        value: toDecimalString(new Decimal(openCount + 1), RATIO_SCALE),
        allowed: toDecimalString(
          new Decimal(input.riskProfile.limits.maxOpenOperations),
          RATIO_SCALE,
        ),
      });
    }
    if (limitBreaches.length > 0) {
      notes.push({
        code: "limit_breach_warned",
        message: "the proposal breaches a risk-profile limit",
      });
    }
  }

  return {
    at: input.at,
    underlying: input.underlying,
    spot,
    riskFreeRate,
    dividendYield,
    legs: legValuations,
    netPremium: toCentavos(netPremiumCentavos.round().toNumber()),
    greeks,
    payoff,
    breakEvens,
    maxLoss,
    maxGain,
    limitBreaches,
    notes,
    provenance: { ...input.provenanceBase, truncated: [] },
  };
}
