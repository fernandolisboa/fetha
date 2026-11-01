import Decimal from "decimal.js";
import type { DecimalString } from "@fetha/contracts";
import type { PayoffPoint } from "../api";
import { bsmPriceRaw } from "./black-scholes";
import { CENTAVOS_PER_REAL, PRICE_SCALE, parseDecimal, toDecimalString } from "./decimal";
import { invariant } from "./invariant";
import type { PricedLeg } from "./price-operation";
import { toCentavos } from "./scalars";

// ADR-0077: samples one percent of spot apart over [0.8x, 1.2x] and on to the farthest strike
// or break-even. A straight chord over a step h misses a convex curve by at most h^2 gamma / 8,
// and a leg's gamma peaks near its strike K at about phi(0) / (K sigma sqrt(T)), so a 1% step
// keeps that gap under 5e-6 S^2 / (K sigma sqrt(T)) per unit. Past 0.8x-1.2x the step widens
// only as much as keeps the grid within MAX_GRID_SAMPLES, so a break-even
// at ten times spot costs a coarser tail, never a thousand samples.
const CORE_LOWER_PERCENT = 80;
const CORE_UPPER_PERCENT = 120;
const MAX_GRID_SAMPLES = 120;

function gridPercents(loPercent: number, hiPercent: number): number[] {
  const core: number[] = [];
  for (let percent = CORE_LOWER_PERCENT; percent <= CORE_UPPER_PERCENT; percent += 1) {
    core.push(percent);
  }
  const outerSpan =
    Math.max(0, CORE_LOWER_PERCENT - loPercent) + Math.max(0, hiPercent - CORE_UPPER_PERCENT);
  const step = Math.max(1, Math.ceil(outerSpan / (MAX_GRID_SAMPLES - core.length)));
  const below: number[] = [];
  for (let percent = CORE_LOWER_PERCENT - step; percent > loPercent; percent -= step) {
    below.push(percent);
  }
  const above: number[] = [];
  for (let percent = CORE_UPPER_PERCENT + step; percent < hiPercent; percent += step) {
    above.push(percent);
  }
  return [...below, ...core, ...above];
}

function gridSpots(spot: Decimal, expiryUnderlyings: readonly Decimal[]): Decimal[] {
  const percentOfSpot = (u: Decimal): Decimal => u.div(spot).mul(100);
  const lo = Decimal.min(CORE_LOWER_PERCENT, ...expiryUnderlyings.map(percentOfSpot));
  const hi = Decimal.max(CORE_UPPER_PERCENT, ...expiryUnderlyings.map(percentOfSpot));
  return gridPercents(lo.floor().toNumber(), hi.ceil().toNumber()).map((percent) =>
    spot.mul(percent).div(100).toDecimalPlaces(PRICE_SCALE),
  );
}

function legValueNow(
  leg: PricedLeg,
  underlying: Decimal,
  riskFreeRate: number,
  dividendYield: number,
): Decimal {
  const role = leg.valuation.leg.role;
  if (role === "stock") return underlying;
  invariant(leg.model !== null, "payoff-now: an option leg without a model was not refused");
  invariant(leg.strike !== null, "payoff-now: an option leg always carries its strike");
  const raw = bsmPriceRaw({
    s: underlying.toNumber(),
    k: Number(leg.strike),
    t: leg.model.timeToExpiryYears,
    r: riskFreeRate,
    q: dividendYield,
    sigma: leg.model.sigma,
    right: role,
  });
  invariant(Number.isFinite(raw), "payoff-now: a positive strike and sigma price finitely");
  return new Decimal(raw).div(leg.priceFactor);
}

// The operation's P&L at the pricing instant: each option leg at the same Black-Scholes value
// (sigma, time to expiry, r, q) its own fair value used, with the underlying moved to the
// sample; a stock leg at the sample itself; both against the leg's premium in this pricing, exactly as
// the expiry curve. Null when any option leg has no model value (no volatility, a model that
// did not price, or an expiry already passed): the curve is omitted, never invented. Null too
// with no option leg at all, where it would only repeat the expiry curve.
export function computePayoffNow(
  legs: readonly PricedLeg[],
  spot: DecimalString,
  expiryUnderlyings: readonly DecimalString[],
  riskFreeRate: DecimalString,
  dividendYield: DecimalString,
): PayoffPoint[] | null {
  const options = legs.filter((leg) => leg.valuation.leg.role !== "stock");
  if (options.length === 0 || options.some((leg) => leg.model === null)) return null;

  const expirySamples = expiryUnderlyings.map((u) => parseDecimal(u));
  const unique = new Map<string, Decimal>();
  for (const s of [...expirySamples, ...gridSpots(parseDecimal(spot), expirySamples)]) {
    unique.set(toDecimalString(s, PRICE_SCALE), s);
  }
  const samples = [...unique.values()].sort((a, b) => a.cmp(b));
  const r = Number(riskFreeRate);
  const q = Number(dividendYield);

  return samples.map((underlying) => {
    const pnl = legs.reduce((acc, leg) => {
      const sign = leg.valuation.leg.side === "buy" ? 1 : -1;
      return acc.add(
        legValueNow(leg, underlying, r, q)
          .sub(leg.premiumPerUnit)
          .mul(sign)
          .mul(leg.valuation.leg.quantity),
      );
    }, new Decimal(0));
    return {
      underlying: toDecimalString(underlying, PRICE_SCALE),
      pnl: toCentavos(pnl.mul(CENTAVOS_PER_REAL).round().toNumber()),
    };
  });
}
