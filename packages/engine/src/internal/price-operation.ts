import Decimal from "decimal.js";
import type { Centavos, DecimalString, RiskProfile, SessionDate } from "@fetha/contracts";
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
  Result,
  TradingSession,
} from "../api";
import { sessionAtOrBefore } from "./calendar";
import { isAtOrBefore } from "./instant";
import {
  CENTAVOS_PER_REAL,
  PRICE_SCALE,
  RATIO_SCALE,
  parseDecimal,
  toDecimalString,
} from "./decimal";
import { invalidInput } from "./errors";
import { GREEK_KEYS, zeroGreeks } from "./greeks";
import { assertDefined } from "./invariant";
import { NO_RISK_PROFILE_NOTE, STALE_PRICE_NOTE } from "./notes";
import { priceOptionLeg } from "./option-pricing";
import type { ProvenanceBase } from "./provenance";
import { resolveDividendYield, resolveRiskFreeRate } from "./rates";
import { resolveLegSelection } from "./resolve-leg-selection";
import { resolveLegMarketPrice, resolveUnderlyingSpot } from "./resolve-market-price";
import { resolveSeries } from "./resolve-series";
import { toCentavos, toQuantity } from "./scalars";
import { resolveTimeToExpiryYears } from "./time-to-expiry";

function sign(side: "buy" | "sell"): 1 | -1 {
  return side === "buy" ? 1 : -1;
}

function err(error: EngineError): Result<OperationPricing> {
  return { ok: false, error };
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

type PricedLeg = {
  valuation: LegValuation;
  strike: DecimalString | null;
  premiumPerUnit: Decimal;
};

// `expiredIntrinsicBasis` is the underlying's own close at the operation's expiry session,
// supplied only when the caller (markToMarket, round 1 item 3) already knows the operation's
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
): { ok: true; leg: PricedLeg } | { ok: false; error: EngineError } {
  const atSession = sessionDateAtOrBefore(view.calendar, at);
  if (leg.role === "stock") {
    const resolved = resolveLegMarketPrice(view, leg.ticker, at, leg.price, atSession, "stock");
    const price = resolved?.value ?? null;
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
        premiumPerUnit: price ? parseDecimal(price) : new Decimal(0),
      },
    };
  }

  const series = resolveSeries(view, leg.ticker, at);
  if (!series) return { ok: false, error: { code: "missing_instrument", ticker: leg.ticker } };
  if (series.underlying !== underlying) {
    return {
      ok: false,
      error: { code: "invalid_input", path: legPath, message: "leg underlying mismatch" },
    };
  }
  if (!isPositive(series.strike)) {
    return {
      ok: false,
      error: invalidInput(`${legPath}.strike`, "a listed strike must be positive"),
    };
  }

  if (expiredIntrinsicBasis !== null) {
    const strike = parseDecimal(series.strike);
    const basis = parseDecimal(expiredIntrinsicBasis);
    const intrinsic =
      leg.role === "call" ? Decimal.max(basis.sub(strike), 0) : Decimal.max(strike.sub(basis), 0);
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
    return { ok: true, leg: { valuation, strike: series.strike, premiumPerUnit: intrinsic } };
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
  // caller-supplied invalid input (PR #53 round 4 item 5).
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
  // market view (round 3 item 9). `resolveLegMarketPrice` already gives the stale row's own
  // session; suppress the solve whenever an ex-date falls strictly after it and at or before
  // the mark session.
  const staleSession = marketPrice?.stale?.session ?? null;
  const suppressStaleImpliedVolatility =
    staleSession !== null &&
    view.corporateActions.some(
      (f) =>
        f.ticker === underlying &&
        f.exDate > staleSession &&
        (atSession === null || f.exDate <= atSession) &&
        isAtOrBefore(f.asOf, at),
    );
  const valuation = priceOptionLeg({
    leg: { role: leg.role, side: leg.side, ticker: leg.ticker, quantity: leg.quantity },
    strike: series.strike,
    spot,
    riskFreeRate,
    dividendYield,
    timeToExpiryYears: tte.years,
    marketPrice,
    givenVolatility: leg.volatility ?? null,
    suppressStaleImpliedVolatility,
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
  const hasStrike = (leg: PricedLeg): leg is PricedLeg & { strike: DecimalString } =>
    leg.strike !== null;
  const strikes = [...new Set(legs.filter(hasStrike).map((l) => l.strike))].map((s) =>
    parseDecimal(s),
  );
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

  // The three coarse samples alone hide every kink: a collar's payoff between 0.8x and 1x
  // spot looks like a straight line unless the put and call strikes are sampled explicitly,
  // so the chart (which only ever draws these points, never interpolates them itself) drew a
  // capped/floored payoff as if it were unprotected (PR #76 round 2 item 1). Emit each leg's
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
};

// The per-leg valuation, its notes and the net premium are what a sizing preview needs
// (item 19, PR #53 round 1): everything a full `OperationPricing` adds on top of this —
// the payoff profile, aggregate greeks, risk-limit checks and provenance — is either
// unneeded for sizing or, for provenance, has no real value to report before the leg
// count is known. Splitting this out means the preview no longer manufactures a fake one.
// Not exported: markToMarket composes through priceConcreteLegs (round 1 item 12), never
// this lower-level step directly.
// `legPathAt` builds the error path for the leg at a given position in `legs`: `priceOperation`
// never needs anything but the plain `legs[i]` default, but `markToMarket` (round 3 item 8)
// needs `operations[i].legs[j]`, `j` being that leg's own position in the *operation's* legs,
// which does not generally equal its position in `legs` here once a residue-only or an
// unpriced-expired leg has been excluded from it (round 3 items 2, 5).
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
  // Aggregated at the operation level next to `no_market_price` above (round 3 item 6): a
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

  return { ok: true, value: { priced, notes, netPremiumCentavos } };
}

// Resolved once per `priceOperation` call and threaded through, rather than re-resolved
// by every step that happens to need a rate: the concrete-legs path resolves it once for
// its single pricing pass, and `priceSelection` resolves it once for strike/expiry
// selection, sizing and the final pricing, all three of which used to re-resolve
// (PR #53 round 1 item 19). Not exported: `priceLegsAt` and `priceOperation` are the only
// public surface of this module (round 3 item 10).
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

// Not exported (round 3 item 10): `priceLegsAt` and `priceOperation` are the only public
// surface of this module.
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
  const { priced, notes: legNotes, netPremiumCentavos } = valued.value;
  const notes: Note[] = [...rateNotes, ...legNotes];

  // A priced leg (it has a market price) with null greeks means the model could not
  // solve one (`iv_not_converged`, `below_intrinsic`): the aggregate below still has to
  // exclude it from the sum, but silently dropping it left a covered call's short leg
  // out of the reported delta with no signal that the aggregate is incomplete
  // (PR #53 round 3 item 3). A leg whose solve was only suppressed across a corporate
  // action (`stale_price_across_corporate_action`, round 3 item 9) already carries its own
  // leg-level note explaining why it has no greeks; flagging the operation-level
  // `iv_not_converged` on top of it would misreport a genuine non-convergence that never
  // happened (round 4 item 2).
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

// Shared by priceOperation's concrete-legs branch and markToMarket's per-operation pricing
// (round 1 item 12): both resolve the underlying's spot and rates, then price a fixed set of
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
  const spot = resolveUnderlyingSpot(view, underlying, at);
  if (!spot) return err({ code: "missing_instrument", ticker: underlying });
  if (!isPositive(spot)) {
    return err(invalidInput(spotPath, "the underlying's spot must be positive"));
  }

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

// Concrete `LegInput[]` legs are not built by `resolveLegSelection`, so nothing else
// guarantees they describe one operation: every stock leg must be the same underlying
// the operation was inferred from, and every option leg must share one listed expiry
// (a calendar spread is a `LegSelection`'s job, once #23 exists — not a concrete-legs
// operation). A leg with no listed series is left for `valueOneLeg`'s own
// `missing_instrument` to report (PR #53 round 1 item 14).
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
  const unboundedMaxLoss = {
    ok: false as const,
    error: { code: "unsizeable", reason: "unbounded_max_loss" },
  } satisfies { ok: false; error: EngineError };

  // `zero_units` here conflates two different reasons: perUnit <= 0 is a genuinely zero
  // max loss/premium, while floor(capital * fraction / perUnit) < 1 is a positive per-unit
  // cost the budget cannot afford one unit of. Left unsplit pending a UnsizeableReason
  // member for the unaffordable case (github.com/fernandolisboa/fetha/issues/59).
  const unitsFromPerUnit = (
    perUnit: Decimal,
  ): { ok: true; units: number } | { ok: false; error: EngineError } => {
    if (perUnit.lte(0)) return zeroUnits;
    const units = capital.mul(fraction).div(perUnit).floor().toNumber();
    return units >= 1 ? { ok: true, units } : zeroUnits;
  };

  if (sizing.kind === "fixed_risk") {
    if (maxLoss === "unbounded") return unboundedMaxLoss;
    return unitsFromPerUnit(new Decimal(maxLoss));
  }

  // fixed_fractional sizes against the capital actually at risk: for a net-credit
  // structure (netPremium > 0, premium received) that is the bounded max loss
  // (ADR-0014's stop_loss base uses the same reasoning), never the premium received,
  // which understates the risk of a spread.
  const isNetCredit = netPremium > 0;
  if (isNetCredit) {
    if (maxLoss === "unbounded") return unboundedMaxLoss;
    return unitsFromPerUnit(new Decimal(maxLoss));
  }
  return unitsFromPerUnit(new Decimal(netPremium).abs());
}

function priceSelection(
  input: PriceOperationInput,
  selection: LegSelection,
  provenanceBase: ProvenanceBase,
): Result<OperationPricing> {
  const spot = resolveUnderlyingSpot(input.view, selection.underlying, input.at);
  if (!spot) return err({ code: "missing_instrument", ticker: selection.underlying });
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

  return priceConcreteLegs(
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
}

export function priceOperation(
  input: PriceOperationInput,
  provenanceBase: ProvenanceBase,
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
