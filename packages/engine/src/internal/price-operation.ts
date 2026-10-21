import Decimal from "decimal.js";
import type { Centavos, DecimalString, RiskProfile, SessionDate } from "@fetha/contracts";
import type {
  CorporateActionFactor,
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
  Result,
  TradingSession,
} from "../api";
import { sessionAtOrBefore } from "./calendar";
import { calendarIntegrityError, corporateActionIntegrityError } from "./validate-view-integrity";
import { isAtOrBefore } from "./instant";
import {
  CENTAVOS_PER_REAL,
  PRICE_SCALE,
  RATIO_SCALE,
  parseDecimal,
  toDecimalString,
  toDecimalStringAtLeastScale,
} from "./decimal";
import { invalidInput, err } from "./errors";
import { GREEK_KEYS, zeroGreeks } from "./greeks";
import { assertDefined } from "./invariant";
import {
  NO_RISK_PROFILE_NOTE,
  OPTION_STRIKE_DERIVED_NOTE,
  OPTION_STRIKE_UNCONFIRMED_NOTE,
  STALE_MARK_RESCALED_ACROSS_CORPORATE_ACTION_NOTE,
  STALE_PRICE_NOTE,
} from "./notes";
import { resolveOptionStrike } from "./option-strike";
import { priceOptionLeg } from "./option-pricing";
import { resolvePriceFactor } from "./price-factor";
import type { ProvenanceBase } from "./provenance";
import { resolveDividendYield, resolveRiskFreeRate } from "./rates";
import { resolveLegSelection } from "./resolve-leg-selection";
import { resolveLegMarketPrice, resolveUnderlyingSpotReading } from "./resolve-market-price";
import { resolveSeries } from "./resolve-series";
import { toCentavos, toQuantity } from "./scalars";
import { rescaleStalePrice } from "./split-factor";
import { resolveTimeToExpiryYears } from "./time-to-expiry";

function sign(side: "buy" | "sell"): 1 | -1 {
  return side === "buy" ? 1 : -1;
}

function isPositive(value: DecimalString): boolean {
  return parseDecimal(value).gt(0);
}

// ADR-0014 Q42: a mark is `stale` when the price row it came from belongs to an earlier
// session than the one being valued (an untraded series marked at its last trade).
function sessionDateAtOrBefore(
  calendar: readonly TradingSession[],
  at: string,
): SessionDate | null {
  return sessionAtOrBefore(calendar, at)?.date ?? null;
}

function visibleUnderlyingFactors(
  view: MarketView,
  underlying: string,
  at: string,
): CorporateActionFactor[] {
  return view.corporateActions.filter((f) => f.ticker === underlying && isAtOrBefore(f.asOf, at));
}

type SpotReading = { spot: DecimalString; rescaled: boolean };

// Issue #285: a spot carried forward from a session before an ex-date (the underlying did not
// trade on it) sits on the pre-factor scale, while every strike derived for that same session
// and every rebased quantity sits on the post-factor one. Rescaled over the same
// `(spot session, session of at]` window a stale leg price is, through the shared
// `rescaleStalePrice`, so the model, the strike selection and the payoff samples all read one
// scale. Kept at full precision, like a rescaled mark (#273).
function resolveSpotOnSessionScale(
  view: MarketView,
  underlying: string,
  at: string,
): { ok: true; value: SpotReading | null } | { ok: false; error: EngineError } {
  const reading = resolveUnderlyingSpotReading(view, underlying, at);
  if (!reading) return { ok: true, value: null };
  const rescaled = rescaleStalePrice(
    visibleUnderlyingFactors(view, underlying, at),
    parseDecimal(reading.value),
    reading.session,
    sessionDateAtOrBefore(view.calendar, at),
  );
  if (!rescaled.ok) return rescaled;
  if (!rescaled.value.rescaled)
    return { ok: true, value: { spot: reading.value, rescaled: false } };
  return {
    ok: true,
    value: {
      spot: toDecimalStringAtLeastScale(rescaled.value.price, PRICE_SCALE),
      rescaled: true,
    },
  };
}

// The web reads notes by code, so a rescale already named on the operation (an option leg's
// IV-suppression note shares the code) is never named twice.
function withStaleRescaleNote(notes: readonly Note[]): Note[] {
  return notes.some((n) => n.code === STALE_MARK_RESCALED_ACROSS_CORPORATE_ACTION_NOTE.code)
    ? [...notes]
    : [...notes, STALE_MARK_RESCALED_ACROSS_CORPORATE_ACTION_NOTE];
}

// Exported for score's own max-loss computation (ADR-0014 Q46/Q13): score builds this same
// shape from an operation's legs priced at their entry premium rather than a fresh market
// price, then reuses computePayoffProfile below instead of re-deriving max loss.
export type PricedLeg = {
  valuation: LegValuation;
  strike: DecimalString | null;
  premiumPerUnit: Decimal;
  // ADR-0063: the series' own `priceFactor` (1 for a stock leg and for every equity option).
  // `strike` above stays in the series' quotation unit; only `payoffAt` below needs this, to
  // scale the intrinsic value it derives from `strike` back down to the same reais
  // `premiumPerUnit` is already on before the two are combined.
  priceFactor: Decimal;
};

// `expiredIntrinsicBasis` is the underlying's own close at the operation's expiry session,
// supplied only when the caller (markToMarket) already knows the operation's
// listed expiry has passed: the usual time-to-expiry lookup below would reject every option
// leg with `invalid_input` ("already_expired"), aborting the whole portfolio's valuation on
// any day after an expiry the user has not yet confirmed a settlement for. `priceOperation`
// never passes this (a caller building a *new* position on an already-expired series is still
// a genuine error), so the parameter defaults to `null`.
function valueOneLeg(
  view: MarketView,
  at: string,
  underlying: string,
  spot: DecimalString,
  riskFreeRate: DecimalString,
  dividendYield: DecimalString,
  leg: LegInput,
  legPath: string,
  expiredIntrinsicBasis: DecimalString | null = null,
): { ok: true; leg: PricedLeg; premiumRescaled: boolean } | { ok: false; error: EngineError } {
  const atSession = sessionDateAtOrBefore(view.calendar, at);
  if (leg.role === "stock") {
    const resolved = resolveLegMarketPrice(view, leg.ticker, at, leg.price, atSession, "stock");
    const price = resolved?.value ?? null;
    // Issue #285: `LegValuation.price` reports the price as it traded; the premium every
    // aggregate (net premium, payoff, limits) multiplies by the effective quantity is rescaled
    // onto the session's scale, the same way markToMarket's unrealized P&L already is (#279).
    const premium = rescaleStalePrice(
      visibleUnderlyingFactors(view, underlying, at),
      price ? parseDecimal(price) : new Decimal(0),
      resolved?.stale?.session ?? null,
      atSession,
    );
    // A stock leg's own stale reading is the underlying's spot reading (same ticker, same
    // ladder), whose rescale over this same window `resolveSpotOnSessionScale` already
    // refused before any leg is valued.
    /* v8 ignore next */
    if (!premium.ok) return premium;
    const valuation: LegValuation = {
      leg: { role: leg.role, side: leg.side, ticker: leg.ticker, quantity: leg.quantity },
      price,
      priceSource: resolved?.source ?? null,
      stale: resolved?.stale ?? null,
      fairValue: null,
      impliedVolatility: null,
      volatilitySource: null,
      greeks: price ? { ...zeroGreeks, delta: toDecimalString(new Decimal(1), RATIO_SCALE) } : null,
      timeToExpiryYears: null,
      notes: price
        ? resolved?.stale
          ? [STALE_PRICE_NOTE]
          : []
        : [{ code: "no_market_price", message: "no market price visible for this leg" }],
    };
    return {
      ok: true,
      leg: {
        valuation,
        strike: null,
        premiumPerUnit: premium.value.price,
        priceFactor: new Decimal(1),
      },
      premiumRescaled: premium.value.rescaled,
    };
  }

  const resolvedStrike = resolveOptionStrike(view, leg.ticker, underlying, atSession, at);
  if (!resolvedStrike.ok) return { ok: false, error: resolvedStrike.error };
  const { series, strike: strikeString, adjustment } = resolvedStrike.value;
  if (series.underlying !== underlying) {
    return {
      ok: false,
      error: { code: "invalid_input", path: legPath, message: "leg underlying mismatch" },
    };
  }
  if (!isPositive(strikeString)) {
    return {
      ok: false,
      error: invalidInput(`${legPath}.strike`, "a listed strike must be positive"),
    };
  }
  const priceFactorResult = resolvePriceFactor(series.priceFactor, `${legPath}.priceFactor`);
  if (!priceFactorResult.ok) return { ok: false, error: priceFactorResult.error };
  const priceFactor = priceFactorResult.value;
  const strikeAdjustmentNote: Note | null =
    adjustment === "derived"
      ? OPTION_STRIKE_DERIVED_NOTE
      : adjustment === "unconfirmed"
        ? OPTION_STRIKE_UNCONFIRMED_NOTE
        : null;

  if (expiredIntrinsicBasis !== null) {
    const strike = parseDecimal(strikeString);
    const basis = parseDecimal(expiredIntrinsicBasis);
    // `strike` and `basis` are both on the series' quotation unit; scaled down to reais per
    // contract (ADR-0063) before this intrinsic value becomes a fair value.
    const intrinsic = (
      leg.role === "call" ? Decimal.max(basis.sub(strike), 0) : Decimal.max(strike.sub(basis), 0)
    ).div(priceFactor);
    const fairValue = toDecimalString(intrinsic, PRICE_SCALE);
    const valuation: LegValuation = {
      leg: { role: leg.role, side: leg.side, ticker: leg.ticker, quantity: leg.quantity },
      price: null,
      priceSource: null,
      stale: null,
      fairValue,
      impliedVolatility: null,
      volatilitySource: null,
      greeks: null,
      timeToExpiryYears: toDecimalString(new Decimal(0), RATIO_SCALE),
      notes: [
        {
          code: "settlement_pending",
          message:
            "the operation's listed expiry has passed; valued at intrinsic pending settlement (ADR-0014 Q41)",
        },
      ],
    };
    if (strikeAdjustmentNote) valuation.notes = [...valuation.notes, strikeAdjustmentNote];
    return {
      ok: true,
      leg: { valuation, strike: strikeString, premiumPerUnit: intrinsic, priceFactor },
      premiumRescaled: false,
    };
  }

  const tte = resolveTimeToExpiryYears(view.calendar, at, series.expiry);
  if (!tte.ok) {
    if (tte.reason === "already_expired") {
      return {
        ok: false,
        error: invalidInput(`${legPath}.expiry`, "the leg's expiry precedes the session of at"),
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
  // A zero given volatility fed bsmPriceRaw directly (option-pricing.ts) and was silently
  // priced at intrinsic value with zeroed greeks, with no note; reject it before pricing so
  // the operation-level iv_not_converged note keeps meaning only non-convergence, never a
  // caller-supplied invalid input.
  if (leg.volatility !== undefined && !isPositive(leg.volatility)) {
    return {
      ok: false,
      error: invalidInput(`${legPath}.volatility`, "a given volatility must be positive"),
    };
  }

  const marketPrice = resolveLegMarketPrice(view, leg.ticker, at, leg.price, atSession);
  // A stale price whose own session predates a corporate-action ex-date visible on the
  // underlying sits on a pre-action scale the current spot no longer shares: solving implied
  // volatility from it would read the split itself as a phantom volatility move, not a real
  // market view, so the solve is suppressed whenever `rescaleStalePrice` finds a factor over
  // `(stale session, session of at]`. Issue #285: the premium the aggregates read is that
  // rescaled price; `LegValuation.price` still reports the price as it traded.
  const premium = rescaleStalePrice(
    visibleUnderlyingFactors(view, underlying, at),
    marketPrice ? parseDecimal(marketPrice.value) : new Decimal(0),
    marketPrice?.stale?.session ?? null,
    atSession,
  );
  // `resolveOptionStrike` above already refused every non-positive visible factor up to the
  // session of at (an unexpired leg's own window), so this window has none left to refuse.
  /* v8 ignore next */
  if (!premium.ok) return premium;
  const valuation = priceOptionLeg({
    leg: { role: leg.role, side: leg.side, ticker: leg.ticker, quantity: leg.quantity },
    strike: strikeString,
    spot,
    riskFreeRate,
    dividendYield,
    timeToExpiryYears: tte.years,
    marketPrice,
    givenVolatility: leg.volatility ?? null,
    suppressStaleImpliedVolatility: premium.value.rescaled,
    priceFactor: series.priceFactor,
  });
  if (strikeAdjustmentNote) valuation.notes = [...valuation.notes, strikeAdjustmentNote];
  const premiumPerUnit = valuation.price
    ? premium.value.price
    : valuation.fairValue
      ? parseDecimal(valuation.fairValue)
      : new Decimal(0);

  return {
    ok: true,
    leg: { valuation, strike: strikeString, premiumPerUnit, priceFactor },
    premiumRescaled: premium.value.rescaled,
  };
}

// A leg's payoff slope as the underlying goes to infinity, in reais per point of the
// underlying's own quotation unit: a put's intrinsic value is capped (slope 0); a stock
// leg's price factor is always 1 (slope 1); an index call's intrinsic value is itself in
// points, divided down to reais by its price factor (ADR-0063) before it meets the
// leg's premium, so its slope is `1 / priceFactor` reais per point, not 1.
function legIntrinsicSlopeAtInfinity(
  role: "stock" | "call" | "put",
  priceFactor: Decimal,
): Decimal {
  if (role === "put") return new Decimal(0);
  if (role === "stock") return new Decimal(1);
  return new Decimal(1).div(priceFactor);
}

function payoffAt(legs: readonly PricedLeg[], underlying: Decimal): Decimal {
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

export function computePayoffProfile(
  legs: readonly PricedLeg[],
  spot: DecimalString,
): {
  payoff: PayoffPoint[];
  breakEvens: DecimalString[];
  maxLoss: Centavos | "unbounded";
  maxGain: Centavos | "unbounded";
} {
  const hasStrike = (leg: PricedLeg): leg is PricedLeg & { strike: DecimalString } =>
    leg.strike !== null;
  const strikes = [...new Set(legs.filter(hasStrike).map((l) => l.strike))].map((s) =>
    parseDecimal(s),
  );
  const points = [new Decimal(0), ...strikes].sort((a, b) => a.cmp(b));

  const slopeAtInfinity = legs.reduce(
    (acc, leg) =>
      acc.add(
        legIntrinsicSlopeAtInfinity(leg.valuation.leg.role, leg.priceFactor).mul(
          sign(leg.valuation.leg.side) * leg.valuation.leg.quantity,
        ),
      ),
    new Decimal(0),
  );

  const evaluated = points.map((p) => ({ point: p, value: payoffAt(legs, p) }));

  const rawBreakEvens: DecimalString[] = [];
  const n = evaluated.length;
  let i = 0;
  while (i < n) {
    const point = assertDefined(evaluated[i], "computePayoffProfile: index within bounds");
    if (point.value.isZero()) {
      // The payoff is linear between consecutive samples, so a run of zero-valued samples
      // can only be left at its own ends; an identically-zero payoff has no crossing
      // (kept by PR #134).
      const runStart = i;
      let runEnd = i;
      while (runEnd + 1 < n && evaluated[runEnd + 1]?.value.isZero()) runEnd += 1;
      const hasLeftNeighbour = runStart > 0;
      const hasRightSample = runEnd + 1 < n;
      const hasRightInfinity = !hasRightSample && !slopeAtInfinity.isZero();
      if (hasLeftNeighbour) {
        rawBreakEvens.push(toDecimalString(point.point, PRICE_SCALE));
      }
      if (hasRightSample || hasRightInfinity) {
        const exitPoint = assertDefined(
          evaluated[runEnd],
          "computePayoffProfile: run end within bounds",
        ).point;
        rawBreakEvens.push(toDecimalString(exitPoint, PRICE_SCALE));
      }
      i = runEnd + 1;
      continue;
    }
    const next = evaluated[i + 1];
    if (next && !next.value.isZero() && point.value.isNeg() !== next.value.isNeg()) {
      const ratio = point.value.neg().div(next.value.sub(point.value));
      const crossing = point.point.add(next.point.sub(point.point).mul(ratio));
      rawBreakEvens.push(toDecimalString(crossing, PRICE_SCALE));
    }
    i += 1;
  }
  const last = evaluated.at(-1);
  if (
    last &&
    !slopeAtInfinity.isZero() &&
    !last.value.isZero() &&
    last.value.isNeg() !== slopeAtInfinity.lt(0)
  ) {
    const crossing = last.point.sub(last.value.div(slopeAtInfinity));
    rawBreakEvens.push(toDecimalString(crossing, PRICE_SCALE));
  }
  // Two crossings less than half a cent apart round to the same PRICE_SCALE value (e.g. a
  // plateau bounded by strikes 39.999 and 40.001, or two interpolated crossings that land on
  // the same cent): dedup on the emitted string, once, here.
  const breakEvens = [...new Set(rawBreakEvens)];

  const values = evaluated.map((e) => e.value);
  const minValue = Decimal.min(...values);
  const maxValue = Decimal.max(...values);

  let maxLoss: Centavos | "unbounded";
  let maxGain: Centavos | "unbounded";
  if (slopeAtInfinity.gt(0)) {
    maxGain = "unbounded";
    maxLoss = toCentavos(
      minValue.isNegative() ? minValue.neg().mul(CENTAVOS_PER_REAL).round().toNumber() : 0,
    );
  } else if (slopeAtInfinity.lt(0)) {
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

  // The three coarse samples alone hide every kink: a collar's payoff between 0.8x and 1x
  // spot looks like a straight line unless the put and call strikes are sampled explicitly,
  // so the chart (which only ever draws these points, never interpolates them itself) drew a
  // capped/floored payoff as if it were unprotected. Emit each leg's
  // strike and each break-even as additional samples, sorted ascending and de-duplicated by
  // their rounded decimal value; `PayoffPoint[]` itself is unchanged.
  const sampleSpots = [0.8, 1, 1.2].map((factor) =>
    parseDecimal(spot).mul(factor).toDecimalPlaces(PRICE_SCALE),
  );
  const strikeSpots = strikes.map((s) => s.toDecimalPlaces(PRICE_SCALE));
  const breakEvenSpots = breakEvens.map((b) => parseDecimal(b).toDecimalPlaces(PRICE_SCALE));
  const uniqueSpots = new Map<string, Decimal>();
  for (const s of [...sampleSpots, ...strikeSpots, ...breakEvenSpots]) {
    uniqueSpots.set(toDecimalString(s, PRICE_SCALE), s);
  }
  const sortedSpots = [...uniqueSpots.values()].sort((a, b) => a.cmp(b));

  const payoff: PayoffPoint[] = sortedSpots.map((underlyingSpot) => ({
    underlying: toDecimalString(underlyingSpot, PRICE_SCALE),
    pnl: toCentavos(payoffAt(legs, underlyingSpot).mul(CENTAVOS_PER_REAL).round().toNumber()),
  }));

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
    notes.push(NO_RISK_PROFILE_NOTE);
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

type ValuedLegs = {
  priced: PricedLeg[];
  notes: Note[];
  netPremiumCentavos: Decimal;
  anyPremiumRescaled: boolean;
};

// The per-leg valuation, its notes and the net premium are what a sizing preview needs:
// everything a full `OperationPricing` adds on top of this —
// the payoff profile, aggregate greeks, risk-limit checks and provenance — is either
// unneeded for sizing or, for provenance, has no real value to report before the leg
// count is known. Splitting this out means the preview no longer manufactures a fake one.
// Not exported: markToMarket composes through priceConcreteLegs, never
// this lower-level step directly.
// `legPathAt` builds the error path for the leg at a given position in `legs`: `priceOperation`
// never needs anything but the plain `legs[i]` default, but `markToMarket`
// needs `operations[i].legs[j]`, `j` being that leg's own position in the *operation's* legs,
// which does not generally equal its position in `legs` here once a residue-only or an
// unpriced-expired leg has been excluded from it.
function valueLegs(
  view: MarketView,
  at: string,
  underlying: string,
  spot: DecimalString,
  riskFreeRate: DecimalString,
  dividendYield: DecimalString,
  legs: readonly LegInput[],
  expiredIntrinsicBasis: DecimalString | null = null,
  legPathAt: (index: number) => string = (index) => `legs[${String(index)}]`,
): { ok: true; value: ValuedLegs } | { ok: false; error: EngineError } {
  const priced: PricedLeg[] = [];
  const notes: Note[] = [];
  let anyLegUnpriced = false;
  let anyLegSettlementPending = false;
  let anyPremiumRescaled = false;
  for (const [index, leg] of legs.entries()) {
    const result = valueOneLeg(
      view,
      at,
      underlying,
      spot,
      riskFreeRate,
      dividendYield,
      leg,
      legPathAt(index),
      expiredIntrinsicBasis,
    );
    if (!result.ok) return { ok: false, error: result.error };
    priced.push(result.leg);
    anyPremiumRescaled ||= result.premiumRescaled;
    notes.push(...result.leg.valuation.notes.filter((n) => n.code === "european_pricing"));
    if (result.leg.valuation.notes.some((n) => n.code === "no_market_price")) {
      anyLegUnpriced = true;
    }
    if (result.leg.valuation.notes.some((n) => n.code === "settlement_pending")) {
      anyLegSettlementPending = true;
    }
  }
  if (anyLegUnpriced) {
    notes.push({
      code: "no_market_price",
      message: "at least one leg has no visible market price",
    });
  }
  // Aggregated at the operation level next to `no_market_price` above: a
  // per-leg `settlement_pending` note alone does not surface on `OperationPricing.notes`,
  // where markToMarket's own portfolio-level aggregation (`ov.pricing.notes.some(...)`) and a
  // caller scanning an operation's own notes without walking every leg both look first.
  if (anyLegSettlementPending) {
    notes.push({
      code: "settlement_pending",
      message:
        "at least one leg's listed expiry has passed; valued at intrinsic pending settlement",
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

  return { ok: true, value: { priced, notes, netPremiumCentavos, anyPremiumRescaled } };
}

// Resolved once per `priceOperation` call and threaded through, rather than re-resolved
// by every step that happens to need a rate: the concrete-legs path resolves it once for
// its single pricing pass, and `priceSelection` resolves it once for strike/expiry
// selection, sizing and the final pricing, all three of which used to re-resolve
// Not exported: `priceLegsAt`, `priceOperation` and
// `priceLegsAtSpot` are the pricing surface of this module (revised by
// the #54 follow-up); `computePayoffProfile` and `PricedLeg` are exported for `score`.
function resolveOperationRates(
  view: MarketView,
  at: string,
  underlying: string,
):
  | { ok: true; riskFreeRate: DecimalString; dividendYield: DecimalString; notes: Note[] }
  | { ok: false; error: EngineError } {
  const riskFreeRateResolution = resolveRiskFreeRate(view.macro, at);
  if (!riskFreeRateResolution.ok) return { ok: false, error: riskFreeRateResolution.error };
  const dividendResolution = resolveDividendYield(view.dividendYields, underlying, at);
  if (!dividendResolution.ok) return { ok: false, error: dividendResolution.error };
  return {
    ok: true,
    riskFreeRate: riskFreeRateResolution.value,
    dividendYield: dividendResolution.value,
    notes: [...riskFreeRateResolution.notes, ...dividendResolution.notes],
  };
}

function priceConcreteLegs(
  view: MarketView,
  at: string,
  underlying: string,
  spot: DecimalString,
  riskFreeRate: DecimalString,
  dividendYield: DecimalString,
  rateNotes: readonly Note[],
  legs: readonly LegInput[],
  riskProfile: RiskProfile | undefined,
  openOperationCount: number | undefined,
  provenanceBase: ProvenanceBase,
  expiredIntrinsicBasis: DecimalString | null = null,
  legPathAt?: (index: number) => string,
): Result<OperationPricing> {
  const valued = valueLegs(
    view,
    at,
    underlying,
    spot,
    riskFreeRate,
    dividendYield,
    legs,
    expiredIntrinsicBasis,
    legPathAt,
  );
  if (!valued.ok) return err(valued.error);
  const { priced, notes: legNotes, netPremiumCentavos, anyPremiumRescaled } = valued.value;
  let notes: Note[] = [...rateNotes, ...legNotes];

  // A priced leg (it has a market price) with null greeks means the model could not
  // solve one (`iv_not_converged`, `below_intrinsic`): the aggregate below still has to
  // exclude it from the sum, but silently dropping it left a covered call's short leg
  // out of the reported delta with no signal that the aggregate is incomplete.
  // A leg whose solve was only suppressed across a corporate
  // action (`stale_price_across_corporate_action`) already carries its own
  // leg-level note explaining why it has no greeks; flagging the operation-level
  // `iv_not_converged` on top of it would misreport a genuine non-convergence that never
  // happened.
  const unpricedGreeksLegs = priced.filter(
    (leg) => leg.valuation.price !== null && !leg.valuation.greeks,
  );
  const suppressedAcrossCorporateAction = (leg: (typeof unpricedGreeksLegs)[number]): boolean =>
    leg.valuation.notes.some((note) => note.code === "stale_price_across_corporate_action");
  if (unpricedGreeksLegs.some((leg) => !suppressedAcrossCorporateAction(leg))) {
    notes.push({
      code: "iv_not_converged",
      message: "at least one priced leg has no greeks; the aggregate excludes it",
    });
  } else if (unpricedGreeksLegs.some(suppressedAcrossCorporateAction)) {
    notes.push({
      code: "stale_price_across_corporate_action",
      message:
        "at least one priced leg's implied volatility was suppressed across a corporate action; the aggregate excludes it",
    });
  }
  if (anyPremiumRescaled) notes = withStaleRescaleNote(notes);

  const { payoff, breakEvens, maxLoss, maxGain } = computePayoffProfile(priced, spot);

  const greeks: Greeks = GREEK_KEYS.reduce(
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

// Everything `priceLegsAt` needs once it already has a spot: resolve the operation's rates
// and price the legs against that spot through `priceConcreteLegs`. `priceStockLegs`
// (`stock-pricing.ts`, #54) is the other caller — its spot is the caller's own explicit
// input, never resolved from `view`, which is why this is split out from `priceLegsAt`
// instead of `priceConcreteLegs` itself being exported: `priceConcreteLegs` also takes an
// already-resolved rate pair and rate notes, which a caller with only a spot has no reason
// to assemble by hand.
export function priceLegsAtSpot(
  view: MarketView,
  at: string,
  underlying: string,
  spot: DecimalString,
  legs: readonly LegInput[],
  riskProfile: RiskProfile | undefined,
  openOperationCount: number | undefined,
  provenanceBase: ProvenanceBase,
  expiredIntrinsicBasis: DecimalString | null = null,
  legPathAt?: (index: number) => string,
): Result<OperationPricing> {
  const ratesResolution = resolveOperationRates(view, at, underlying);
  if (!ratesResolution.ok) return err(ratesResolution.error);

  return priceConcreteLegs(
    view,
    at,
    underlying,
    spot,
    ratesResolution.riskFreeRate,
    ratesResolution.dividendYield,
    ratesResolution.notes,
    legs,
    riskProfile,
    openOperationCount,
    provenanceBase,
    expiredIntrinsicBasis,
    legPathAt,
  );
}

// Shared by priceOperation's concrete-legs branch and markToMarket's per-operation pricing:
// both resolve the underlying's spot and rates, then price a fixed set of
// legs through priceConcreteLegs, differing only in the error path a non-positive spot
// reports (an operation-indexed path for markToMarket, a bare "spot" for a fresh proposal).
export function priceLegsAt(
  view: MarketView,
  at: string,
  underlying: string,
  legs: readonly LegInput[],
  riskProfile: RiskProfile | undefined,
  openOperationCount: number | undefined,
  provenanceBase: ProvenanceBase,
  spotPath: string,
  expiredIntrinsicBasis: DecimalString | null = null,
  legPathAt?: (index: number) => string,
): Result<OperationPricing> {
  const spotResult = resolveSpotOnSessionScale(view, underlying, at);
  if (!spotResult.ok) return err(spotResult.error);
  const reading = spotResult.value;
  if (!reading) return err({ code: "missing_instrument", ticker: underlying });
  if (!isPositive(reading.spot)) {
    return err(invalidInput(spotPath, "the underlying's spot must be positive"));
  }

  const priced = priceLegsAtSpot(
    view,
    at,
    underlying,
    reading.spot,
    legs,
    riskProfile,
    openOperationCount,
    provenanceBase,
    expiredIntrinsicBasis,
    legPathAt,
  );
  if (!priced.ok || !reading.rescaled) return priced;
  return { ok: true, value: { ...priced.value, notes: withStaleRescaleNote(priced.value.notes) } };
}

// Concrete `LegInput[]` legs are not built by `resolveLegSelection`, so nothing else
// guarantees they describe one operation: every stock leg must be the same underlying
// the operation was inferred from, and every option leg must share one listed expiry
// (a calendar spread is a `LegSelection`'s job, once #23 exists — not a concrete-legs
// operation). A leg with no listed series is left for `valueOneLeg`'s own
// `missing_instrument` to report.
function validateConcreteLegs(
  view: MarketView,
  at: string,
  underlying: string,
  legs: readonly LegInput[],
): EngineError | null {
  for (const leg of legs) {
    if (leg.role === "stock" && leg.ticker !== underlying) {
      return invalidInput("legs", "every stock leg must share the operation's underlying");
    }
  }
  const expiries = new Set<string>();
  for (const leg of legs) {
    if (leg.role === "stock") continue;
    const series = resolveSeries(view, leg.ticker, at);
    if (series) expiries.add(series.expiry);
  }
  if (expiries.size > 1) {
    return invalidInput("legs", "every option leg must share one expiry");
  }
  return null;
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
  const series = resolveSeries(view, firstOption.ticker, at);
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
  riskFreeRate: DecimalString,
  dividendYield: DecimalString,
  riskProfile: RiskProfile | undefined,
  buildLegs: (units: number) => LegInput[],
): { ok: true; units: number } | { ok: false; error: EngineError } {
  if (typeof selection.quantity === "number") return { ok: true, units: selection.quantity };

  const sizing = selection.quantity;
  if (!riskProfile)
    return { ok: false, error: { code: "unsizeable", reason: "no_declared_capital" } };

  const preview = valueLegs(view, at, underlying, spot, riskFreeRate, dividendYield, buildLegs(1));
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
  const { maxLoss } = computePayoffProfile(preview.value.priced, spot);
  const netPremium = toCentavos(preview.value.netPremiumCentavos.round().toNumber());

  const capital = new Decimal(riskProfile.declaredCapital);
  const fraction = parseDecimal(sizing.fraction);
  const zeroUnits = {
    ok: false as const,
    error: { code: "unsizeable", reason: "zero_units" },
  } satisfies { ok: false; error: EngineError };
  const unaffordableBudget = {
    ok: false as const,
    error: { code: "unsizeable", reason: "unaffordable_budget" },
  } satisfies { ok: false; error: EngineError };
  const unboundedMaxLoss = {
    ok: false as const,
    error: { code: "unsizeable", reason: "unbounded_max_loss" },
  } satisfies { ok: false; error: EngineError };

  // `perUnit <= 0` is a genuinely zero max loss/premium (`zero_units`); a positive per-unit
  // cost that `floor(capital * fraction / perUnit) < 1` cannot afford one unit of is a
  // different situation (`unaffordable_budget`, issue #59): the structure has real risk or
  // premium, the declared capital and fraction just do not cover one unit of it.
  const unitsFromPerUnit = (
    perUnit: Decimal,
  ): { ok: true; units: number } | { ok: false; error: EngineError } => {
    if (perUnit.lte(0)) return zeroUnits;
    const units = capital.mul(fraction).div(perUnit).floor().toNumber();
    return units >= 1 ? { ok: true, units } : unaffordableBudget;
  };

  if (sizing.kind === "fixed_risk") {
    if (maxLoss === "unbounded") return unboundedMaxLoss;
    return unitsFromPerUnit(new Decimal(maxLoss));
  }

  // fixed_fractional sizes against the capital actually at risk: for a non-debit
  // structure (netPremium >= 0, premium received or zero, e.g. a zero-cost risk
  // reversal) that is the bounded max loss (ADR-0014's stop_loss base uses the same
  // reasoning), never the premium received, which understates the risk of a spread.
  const isNonDebit = netPremium >= 0;
  if (isNonDebit) {
    if (maxLoss === "unbounded") return unboundedMaxLoss;
    return unitsFromPerUnit(new Decimal(maxLoss));
  }
  // A net-debit structure with a short leg can still lose more than the premium paid
  // (issue #131, e.g. a short put under a long call). A structure with no short leg has
  // max loss <= premium paid (e.g. a married put or a long guts strangle), so the
  // premium wins the max below and sizing is unchanged for it.
  if (maxLoss === "unbounded") return unboundedMaxLoss;
  return unitsFromPerUnit(Decimal.max(new Decimal(maxLoss), new Decimal(netPremium).abs()));
}

function priceSelection(
  input: PriceOperationInput,
  selection: LegSelection,
  provenanceBase: ProvenanceBase,
): Result<OperationPricing> {
  const spotResult = resolveSpotOnSessionScale(input.view, selection.underlying, input.at);
  if (!spotResult.ok) return err(spotResult.error);
  const reading = spotResult.value;
  if (!reading) return err({ code: "missing_instrument", ticker: selection.underlying });
  const spot = reading.spot;
  if (!isPositive(spot)) {
    return err(invalidInput("spot", "the underlying's spot must be positive"));
  }

  const ratesResolution = resolveOperationRates(input.view, input.at, selection.underlying);
  if (!ratesResolution.ok) return err(ratesResolution.error);
  const { riskFreeRate, dividendYield, notes: rateNotes } = ratesResolution;

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
    riskFreeRate,
    dividendYield,
    input.riskProfile,
    buildLegs,
  );
  if (!sizing.ok) return err(sizing.error);

  const priced = priceConcreteLegs(
    input.view,
    input.at,
    selection.underlying,
    spot,
    riskFreeRate,
    dividendYield,
    rateNotes,
    buildLegs(sizing.units),
    input.riskProfile,
    input.openOperationCount,
    provenanceBase,
  );
  if (!priced.ok || !reading.rescaled) return priced;
  return { ok: true, value: { ...priced.value, notes: withStaleRescaleNote(priced.value.notes) } };
}

export function priceOperation(
  input: PriceOperationInput,
  provenanceBase: ProvenanceBase,
): Result<OperationPricing> {
  const calendarError = calendarIntegrityError(input.view.calendar);
  if (calendarError) return err(calendarError);
  const corporateActionError = corporateActionIntegrityError(input.view.corporateActions);
  if (corporateActionError) return err(corporateActionError);
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
    const consistencyError = validateConcreteLegs(
      input.view,
      input.at,
      underlyingResult.underlying,
      input.legs,
    );
    if (consistencyError) return err(consistencyError);
    return priceLegsAt(
      input.view,
      input.at,
      underlyingResult.underlying,
      input.legs,
      input.riskProfile,
      input.openOperationCount,
      provenanceBase,
      "spot",
    );
  }
  return priceSelection(input, input.legs, provenanceBase);
}
