import Decimal from "decimal.js";
import type { Centavos, DecimalString, RiskProfile } from "@fetha/contracts";
import type {
  EngineError,
  Greeks,
  LegInput,
  LegSelection,
  LegValuation,
  LimitBreach,
  MarketView,
  Note,
  OperationPricing,
  PayoffPoint,
  PriceOperationInput,
  Provenance,
  Result,
} from "../api";
import {
  CENTAVOS_PER_REAL,
  PRICE_SCALE,
  RATIO_SCALE,
  parseDecimal,
  toDecimalString,
} from "./decimal";
import { assertDefined } from "./invariant";
import { isAtOrBefore } from "./instant";
import { priceOptionLeg } from "./option-pricing";
import { resolveDividendYield, resolveRiskFreeRate } from "./rates";
import { resolveLegSelection } from "./resolve-leg-selection";
import { resolveLegMarketPrice } from "./resolve-market-price";
import { toCentavos, toQuantity } from "./scalars";
import { resolveTimeToExpiryYears } from "./time-to-expiry";
import { latestVisible } from "./visible";

const ZERO_RATIO = toDecimalString(new Decimal(0), RATIO_SCALE);
const zeroGreeks: Greeks = {
  delta: ZERO_RATIO,
  gamma: ZERO_RATIO,
  theta: ZERO_RATIO,
  vega: ZERO_RATIO,
  rho: ZERO_RATIO,
};

function sign(side: "buy" | "sell"): 1 | -1 {
  return side === "buy" ? 1 : -1;
}

function err(error: EngineError): Result<OperationPricing> {
  return { ok: false, error };
}

function isPositive(value: DecimalString): boolean {
  return parseDecimal(value).gt(0);
}

function invalidInput(path: string, message: string): EngineError {
  return { code: "invalid_input", path, message };
}

// Same precedence as a leg's own price (resolve-market-price.ts): mid before last, so the
// underlying's spot resolves the same way whether it is read as "the spot" or priced as a
// leg of its own operation (item 18, PR #53 round 1).
function resolveUnderlyingMarketPrice(
  view: MarketView,
  ticker: string,
  at: string,
): DecimalString | null {
  const quote = latestVisible(
    view.quotes.filter((q) => q.ticker === ticker),
    at,
  );
  if (quote?.bid && quote.ask) {
    return toDecimalString(
      parseDecimal(quote.bid).add(parseDecimal(quote.ask)).div(2),
      PRICE_SCALE,
    );
  }
  if (quote?.last) return quote.last;
  const candle = view.candles
    .filter((c) => c.ticker === ticker && c.timeframe === "D1" && isAtOrBefore(c.asOf, at))
    .sort((a, b) => (a.asOf < b.asOf ? -1 : a.asOf > b.asOf ? 1 : 0))
    .at(-1);
  return candle?.close ?? null;
}

type PricedLeg = {
  valuation: LegValuation;
  strike: DecimalString | null;
  premiumPerUnit: Decimal;
};

function valueOneLeg(
  view: MarketView,
  at: string,
  underlying: string,
  spot: DecimalString,
  riskFreeRate: DecimalString,
  dividendYield: DecimalString,
  leg: LegInput,
): { ok: true; leg: PricedLeg } | { ok: false; error: EngineError } {
  if (leg.role === "stock") {
    const resolved = resolveLegMarketPrice(view, leg.ticker, at, leg.price);
    const price = resolved?.value ?? null;
    const valuation: LegValuation = {
      leg: { role: leg.role, side: leg.side, ticker: leg.ticker, quantity: leg.quantity },
      price,
      priceSource: resolved?.source ?? null,
      stale: null,
      fairValue: null,
      impliedVolatility: null,
      volatilitySource: null,
      greeks: price ? { ...zeroGreeks, delta: toDecimalString(new Decimal(1), RATIO_SCALE) } : null,
      timeToExpiryYears: null,
      notes: price
        ? []
        : [{ code: "no_market_price", message: "no market price visible for this leg" }],
    };
    return {
      ok: true,
      leg: {
        valuation,
        strike: null,
        premiumPerUnit: price ? parseDecimal(price) : new Decimal(0),
      },
    };
  }

  const series = view.optionSeries.find(
    (candidate) => candidate.ticker === leg.ticker && isAtOrBefore(candidate.asOf, at),
  );
  if (!series) return { ok: false, error: { code: "missing_instrument", ticker: leg.ticker } };
  if (series.underlying !== underlying) {
    return {
      ok: false,
      error: { code: "invalid_input", path: "legs", message: "leg underlying mismatch" },
    };
  }
  if (!isPositive(series.strike)) {
    return {
      ok: false,
      error: invalidInput("legs.strike", "a listed strike must be positive"),
    };
  }

  const tte = resolveTimeToExpiryYears(view.calendar, at, series.expiry);
  if (!tte.ok) {
    if (tte.reason === "already_expired") {
      return {
        ok: false,
        error: invalidInput("legs.expiry", "the leg's expiry precedes the session of at"),
      };
    }
    return {
      ok: false,
      error: {
        code: "insufficient_data",
        needed: {
          from: at,
          to: at,
          instruments: [leg.ticker],
          timeframes: [],
          collections: ["candles"],
        },
      },
    };
  }
  const marketPrice = resolveLegMarketPrice(view, leg.ticker, at, leg.price);
  const valuation = priceOptionLeg({
    leg: { role: leg.role, side: leg.side, ticker: leg.ticker, quantity: leg.quantity },
    strike: series.strike,
    spot,
    riskFreeRate,
    dividendYield,
    timeToExpiryYears: tte.years,
    marketPrice,
    givenVolatility: leg.volatility ?? null,
  });
  const premiumPerUnit = valuation.price
    ? parseDecimal(valuation.price)
    : valuation.fairValue
      ? parseDecimal(valuation.fairValue)
      : new Decimal(0);

  return { ok: true, leg: { valuation, strike: series.strike, premiumPerUnit } };
}

function legIntrinsicSlopeAtInfinity(role: "stock" | "call" | "put"): number {
  return role === "put" ? 0 : 1;
}

function payoffAt(legs: readonly PricedLeg[], underlying: Decimal): Decimal {
  return legs.reduce((acc, leg) => {
    const role = leg.valuation.leg.role;
    const value =
      role === "stock"
        ? underlying
        : role === "call"
          ? Decimal.max(underlying.sub(leg.strike ?? "0"), 0)
          : Decimal.max(new Decimal(leg.strike ?? "0").sub(underlying), 0);
    const legSign = sign(leg.valuation.leg.side);
    const pnlPerUnit = value.sub(leg.premiumPerUnit).mul(legSign);
    return acc.add(pnlPerUnit.mul(leg.valuation.leg.quantity));
  }, new Decimal(0));
}

function computePayoffProfile(
  legs: readonly PricedLeg[],
  spot: DecimalString,
): {
  payoff: PayoffPoint[];
  breakEvens: DecimalString[];
  maxLoss: Centavos | "unbounded";
  maxGain: Centavos | "unbounded";
} {
  const strikes = [
    ...new Set(legs.filter((l) => l.strike !== null).map((l) => l.strike as DecimalString)),
  ].map((s) => parseDecimal(s));
  const points = [new Decimal(0), ...strikes].sort((a, b) => a.cmp(b));

  const slopeAtInfinity = legs.reduce(
    (acc, leg) =>
      acc +
      sign(leg.valuation.leg.side) *
        legIntrinsicSlopeAtInfinity(leg.valuation.leg.role) *
        leg.valuation.leg.quantity,
    0,
  );

  const evaluated = points.map((p) => ({ point: p, value: payoffAt(legs, p) }));

  const breakEvens: DecimalString[] = [];
  const first = evaluated[0];
  if (first && first.value.isZero()) {
    breakEvens.push(toDecimalString(first.point, PRICE_SCALE));
  }
  for (let i = 1; i < evaluated.length; i += 1) {
    const prev = evaluated[i - 1];
    const curr = evaluated[i];
    if (!prev || !curr) continue;
    if (prev.value.isZero()) continue;
    if (prev.value.isNeg() !== curr.value.isNeg() && !curr.value.isZero()) {
      const ratio = prev.value.neg().div(curr.value.sub(prev.value));
      const crossing = prev.point.add(curr.point.sub(prev.point).mul(ratio));
      breakEvens.push(toDecimalString(crossing, PRICE_SCALE));
    } else if (curr.value.isZero()) {
      breakEvens.push(toDecimalString(curr.point, PRICE_SCALE));
    }
  }
  const last = evaluated.at(-1);
  if (
    last &&
    slopeAtInfinity !== 0 &&
    !last.value.isZero() &&
    last.value.isNeg() !== slopeAtInfinity < 0
  ) {
    const crossing = last.point.sub(last.value.div(slopeAtInfinity));
    breakEvens.push(toDecimalString(crossing, PRICE_SCALE));
  }

  const values = evaluated.map((e) => e.value);
  const minValue = Decimal.min(...values);
  const maxValue = Decimal.max(...values);

  let maxLoss: Centavos | "unbounded";
  let maxGain: Centavos | "unbounded";
  if (slopeAtInfinity > 0) {
    maxGain = "unbounded";
    maxLoss = toCentavos(
      minValue.isNegative() ? minValue.neg().mul(CENTAVOS_PER_REAL).round().toNumber() : 0,
    );
  } else if (slopeAtInfinity < 0) {
    maxLoss = "unbounded";
    maxGain = toCentavos(
      maxValue.isPositive() ? maxValue.mul(CENTAVOS_PER_REAL).round().toNumber() : 0,
    );
  } else {
    maxLoss = toCentavos(
      minValue.isNegative() ? minValue.neg().mul(CENTAVOS_PER_REAL).round().toNumber() : 0,
    );
    maxGain = toCentavos(
      maxValue.isPositive() ? maxValue.mul(CENTAVOS_PER_REAL).round().toNumber() : 0,
    );
  }

  const payoff: PayoffPoint[] = [0.8, 1, 1.2].map((factor) => {
    const underlyingPoint = parseDecimal(spot).mul(factor);
    return {
      underlying: toDecimalString(underlyingPoint, PRICE_SCALE),
      pnl: toCentavos(payoffAt(legs, underlyingPoint).mul(CENTAVOS_PER_REAL).round().toNumber()),
    };
  });

  return { payoff, breakEvens, maxLoss, maxGain };
}

function applyRiskLimits(
  legs: readonly PricedLeg[],
  netPremiumCentavos: Decimal,
  maxLoss: Centavos | "unbounded",
  riskProfile: RiskProfile | undefined,
  openOperationCount: number | undefined,
  notes: Note[],
): LimitBreach[] {
  const limitBreaches: LimitBreach[] = [];
  if (!riskProfile) {
    notes.push({
      code: "no_risk_profile",
      message: "no risk profile supplied; limits not checked",
    });
    return limitBreaches;
  }

  const capital = new Decimal(riskProfile.declaredCapital);
  if (capital.gt(0)) {
    if (maxLoss !== "unbounded") {
      const ratio = new Decimal(maxLoss).div(capital);
      const allowed = parseDecimal(riskProfile.limits.maxLossPerOperation);
      if (ratio.gt(allowed)) {
        limitBreaches.push({
          limit: "maxLossPerOperation",
          value: toDecimalString(ratio, RATIO_SCALE),
          allowed: riskProfile.limits.maxLossPerOperation,
        });
      }
    }
    const notionalCentavos = legs.reduce(
      (acc, leg) =>
        acc.add(leg.premiumPerUnit.mul(CENTAVOS_PER_REAL).mul(leg.valuation.leg.quantity)),
      new Decimal(0),
    );
    const exposureRatio = notionalCentavos.div(capital);
    const allowedExposure = parseDecimal(riskProfile.limits.maxExposurePerOperation);
    if (exposureRatio.gt(allowedExposure)) {
      limitBreaches.push({
        limit: "maxExposurePerOperation",
        value: toDecimalString(exposureRatio, RATIO_SCALE),
        allowed: riskProfile.limits.maxExposurePerOperation,
      });
    }
    if (netPremiumCentavos.isNegative()) {
      const premiumRatio = netPremiumCentavos.neg().div(capital);
      const allowedPremium = parseDecimal(riskProfile.limits.maxPremiumBought);
      if (premiumRatio.gt(allowedPremium)) {
        limitBreaches.push({
          limit: "maxPremiumBought",
          value: toDecimalString(premiumRatio, RATIO_SCALE),
          allowed: riskProfile.limits.maxPremiumBought,
        });
      }
    }
  }
  const openCount = openOperationCount ?? 0;
  if (openCount + 1 > riskProfile.limits.maxOpenOperations) {
    limitBreaches.push({
      limit: "maxOpenOperations",
      value: toDecimalString(new Decimal(openCount + 1), RATIO_SCALE),
      allowed: toDecimalString(new Decimal(riskProfile.limits.maxOpenOperations), RATIO_SCALE),
    });
  }
  if (limitBreaches.length > 0) {
    notes.push({
      code: "limit_breach_warned",
      message: "the proposal breaches a risk-profile limit",
    });
  }
  return limitBreaches;
}

function priceConcreteLegs(
  view: MarketView,
  at: string,
  underlying: string,
  spot: DecimalString,
  legs: readonly LegInput[],
  riskProfile: RiskProfile | undefined,
  openOperationCount: number | undefined,
  provenanceBase: Pick<
    Provenance,
    "engineVersion" | "pricingModel" | "dataVersion" | "datasetNotes"
  >,
): Result<OperationPricing> {
  const riskFreeRateResolution = resolveRiskFreeRate(view.macro, at);
  if (!riskFreeRateResolution.ok) return err(riskFreeRateResolution.error);
  const dividendResolution = resolveDividendYield(view.dividendYields, underlying, at);
  if (!dividendResolution.ok) return err(dividendResolution.error);
  const riskFreeRate = riskFreeRateResolution.value;
  const dividendYield = dividendResolution.value;
  const notes: Note[] = [...riskFreeRateResolution.notes, ...dividendResolution.notes];

  const priced: PricedLeg[] = [];
  let anyLegUnpriced = false;
  for (const leg of legs) {
    const result = valueOneLeg(view, at, underlying, spot, riskFreeRate, dividendYield, leg);
    if (!result.ok) return err(result.error);
    priced.push(result.leg);
    notes.push(...result.leg.valuation.notes.filter((n) => n.code === "european_pricing"));
    if (result.leg.valuation.notes.some((n) => n.code === "no_market_price")) {
      anyLegUnpriced = true;
    }
  }
  if (anyLegUnpriced) {
    notes.push({
      code: "no_market_price",
      message: "at least one leg has no visible market price",
    });
  }

  const netPremiumCentavos = priced.reduce(
    (acc, leg) =>
      acc.add(
        new Decimal(sign(leg.valuation.leg.side))
          .neg()
          .mul(leg.premiumPerUnit.mul(CENTAVOS_PER_REAL))
          .mul(leg.valuation.leg.quantity),
      ),
    new Decimal(0),
  );

  const { payoff, breakEvens, maxLoss, maxGain } = computePayoffProfile(priced, spot);

  const greeks: Greeks = (["delta", "gamma", "theta", "vega", "rho"] as const).reduce(
    (acc, key) => {
      const total = priced.reduce((sum, leg) => {
        if (!leg.valuation.greeks) return sum;
        return sum.add(
          new Decimal(sign(leg.valuation.leg.side))
            .mul(leg.valuation.leg.quantity)
            .mul(leg.valuation.greeks[key]),
        );
      }, new Decimal(0));
      return { ...acc, [key]: toDecimalString(total, RATIO_SCALE) };
    },
    { ...zeroGreeks },
  );

  const limitBreaches = applyRiskLimits(
    priced,
    netPremiumCentavos,
    maxLoss,
    riskProfile,
    openOperationCount,
    notes,
  );

  return {
    ok: true,
    value: {
      at: at,
      underlying: underlying,
      spot,
      riskFreeRate,
      dividendYield,
      legs: priced.map((p) => p.valuation),
      netPremium: toCentavos(netPremiumCentavos.round().toNumber()),
      greeks,
      payoff,
      breakEvens,
      maxLoss,
      maxGain,
      limitBreaches,
      notes,
      provenance: { ...provenanceBase, truncated: [] },
    },
  };
}

function resolveUnderlyingFromLegs(
  view: MarketView,
  at: string,
  legs: readonly [LegInput, ...LegInput[]],
): { ok: true; underlying: string } | { ok: false; error: EngineError } {
  for (const leg of legs) {
    if (leg.role === "stock") return { ok: true, underlying: leg.ticker };
  }
  const [firstOption] = legs;
  const series = view.optionSeries.find(
    (candidate) => candidate.ticker === firstOption.ticker && isAtOrBefore(candidate.asOf, at),
  );
  if (!series)
    return { ok: false, error: { code: "missing_instrument", ticker: firstOption.ticker } };
  return { ok: true, underlying: series.underlying };
}

function resolveSizingUnits(
  selection: LegSelection,
  view: MarketView,
  at: string,
  underlying: string,
  spot: DecimalString,
  riskProfile: RiskProfile | undefined,
  buildLegs: (units: number) => LegInput[],
): { ok: true; units: number } | { ok: false; error: EngineError } {
  if (typeof selection.quantity === "number") return { ok: true, units: selection.quantity };

  const sizing = selection.quantity;
  if (!riskProfile)
    return { ok: false, error: { code: "unsizeable", reason: "no_declared_capital" } };

  const preview = priceConcreteLegs(
    view,
    at,
    underlying,
    spot,
    buildLegs(1),
    undefined,
    undefined,
    {
      engineVersion: "",
      pricingModel: "bsm_continuous_yield",
      dataVersion: null,
      datasetNotes: [],
    },
  );
  if (!preview.ok) return { ok: false, error: preview.error };
  if (preview.value.notes.some((n) => n.code === "no_market_price")) {
    return {
      ok: false,
      error: {
        code: "insufficient_data",
        needed: {
          from: at,
          to: at,
          instruments: [underlying],
          timeframes: [],
          collections: ["optionPrices"],
        },
      },
    };
  }

  const capital = new Decimal(riskProfile.declaredCapital);
  const fraction = parseDecimal(sizing.fraction);
  const zeroUnits = {
    ok: false as const,
    error: { code: "unsizeable", reason: "zero_units" },
  } satisfies { ok: false; error: EngineError };
  const unboundedMaxLoss = {
    ok: false as const,
    error: { code: "unsizeable", reason: "unbounded_max_loss" },
  } satisfies { ok: false; error: EngineError };

  const unitsFromPerUnit = (
    perUnit: Decimal,
  ): { ok: true; units: number } | { ok: false; error: EngineError } => {
    if (perUnit.lte(0)) return zeroUnits;
    const units = capital.mul(fraction).div(perUnit).floor().toNumber();
    return units >= 1 ? { ok: true, units } : zeroUnits;
  };

  if (sizing.kind === "fixed_risk") {
    if (preview.value.maxLoss === "unbounded") return unboundedMaxLoss;
    return unitsFromPerUnit(new Decimal(preview.value.maxLoss));
  }

  // fixed_fractional sizes against the capital actually at risk: for a net-credit
  // structure (netPremium > 0, premium received) that is the bounded max loss
  // (ADR-0014's stop_loss base uses the same reasoning), never the premium received,
  // which understates the risk of a spread.
  const isNetCredit = preview.value.netPremium > 0;
  if (isNetCredit) {
    if (preview.value.maxLoss === "unbounded") return unboundedMaxLoss;
    return unitsFromPerUnit(new Decimal(preview.value.maxLoss));
  }
  return unitsFromPerUnit(new Decimal(preview.value.netPremium).abs());
}

function priceSelection(
  input: PriceOperationInput,
  selection: LegSelection,
  provenanceBase: Pick<
    Provenance,
    "engineVersion" | "pricingModel" | "dataVersion" | "datasetNotes"
  >,
): Result<OperationPricing> {
  const spot = resolveUnderlyingMarketPrice(input.view, selection.underlying, input.at);
  if (!spot) return err({ code: "missing_instrument", ticker: selection.underlying });
  if (!isPositive(spot)) {
    return err(invalidInput("spot", "the underlying's spot must be positive"));
  }

  const riskFreeRateResolution = resolveRiskFreeRate(input.view.macro, input.at);
  if (!riskFreeRateResolution.ok) return err(riskFreeRateResolution.error);
  const dividendResolution = resolveDividendYield(
    input.view.dividendYields,
    selection.underlying,
    input.at,
  );
  if (!dividendResolution.ok) return err(dividendResolution.error);
  const riskFreeRate = riskFreeRateResolution.value;
  const dividendYield = dividendResolution.value;

  const resolution = resolveLegSelection({
    structure: selection.structure,
    underlying: selection.underlying,
    strikes: selection.strikes,
    expiry: selection.expiry,
    view: input.view,
    at: input.at,
    spot,
    riskFreeRate,
    dividendYield,
  });
  if (!resolution.ok) return err(resolution.error);

  const buildLegs = (units: number): LegInput[] =>
    resolution.legs.map((resolved) => {
      const template = assertDefined(
        selection.structure.legs[resolved.templateIndex],
        "resolveLegSelection returned a templateIndex outside the structure's legs",
      );
      const quantity = toQuantity(template.ratio * units);
      if (resolved.role === "stock") {
        return { role: "stock", side: template.side, ticker: selection.underlying, quantity };
      }
      return { role: resolved.role, side: template.side, ticker: resolved.series.ticker, quantity };
    });

  const sizing = resolveSizingUnits(
    selection,
    input.view,
    input.at,
    selection.underlying,
    spot,
    input.riskProfile,
    buildLegs,
  );
  if (!sizing.ok) return err(sizing.error);

  return priceConcreteLegs(
    input.view,
    input.at,
    selection.underlying,
    spot,
    buildLegs(sizing.units),
    input.riskProfile,
    input.openOperationCount,
    provenanceBase,
  );
}

export function priceOperation(
  input: PriceOperationInput,
  provenanceBase: Pick<
    Provenance,
    "engineVersion" | "pricingModel" | "dataVersion" | "datasetNotes"
  >,
): Result<OperationPricing> {
  if (Array.isArray(input.legs)) {
    const [firstLeg] = input.legs;
    if (!firstLeg) {
      return err({ code: "invalid_input", path: "legs", message: "at least one leg is required" });
    }
    const underlyingResult = resolveUnderlyingFromLegs(input.view, input.at, [
      firstLeg,
      ...input.legs.slice(1),
    ]);
    if (!underlyingResult.ok) return err(underlyingResult.error);
    const spot = resolveUnderlyingMarketPrice(input.view, underlyingResult.underlying, input.at);
    if (!spot) return err({ code: "missing_instrument", ticker: underlyingResult.underlying });
    if (!isPositive(spot)) {
      return err(invalidInput("spot", "the underlying's spot must be positive"));
    }
    return priceConcreteLegs(
      input.view,
      input.at,
      underlyingResult.underlying,
      spot,
      input.legs,
      input.riskProfile,
      input.openOperationCount,
      provenanceBase,
    );
  }
  return priceSelection(input, input.legs, provenanceBase);
}
