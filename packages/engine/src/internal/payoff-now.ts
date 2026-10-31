import Decimal from "decimal.js";
import type { DecimalString } from "@fetha/contracts";
import type { PayoffPoint } from "../api";
import { bsmPriceRaw } from "./black-scholes";
import { CENTAVOS_PER_REAL, PRICE_SCALE, parseDecimal, toDecimalString } from "./decimal";
import { invariant } from "./invariant";
import type { PricedLeg } from "./price-operation";
import { toCentavos } from "./scalars";

// ADR-0077: 41 samples one percent of spot apart over [0.8x, 1.2x]. A straight chord over a
// step h misses a convex curve by at most h^2 * gamma / 8, and Black-Scholes gamma peaks at
// phi(0) / (S sigma sqrt(T)), so at h = 0.01 S the gap is under 5e-6 S / (sigma sqrt(T)) per
// unit: under 0.1% of the 0.4 S range whenever sigma sqrt(T) >= 0.0125 (20% vol, one session).
const GRID_LOWER_PERCENT = 80;
const GRID_UPPER_PERCENT = 120;

function gridSpots(spot: Decimal): Decimal[] {
  const spots: Decimal[] = [];
  for (let percent = GRID_LOWER_PERCENT; percent <= GRID_UPPER_PERCENT; percent += 1) {
    spots.push(spot.mul(percent).div(100).toDecimalPlaces(PRICE_SCALE));
  }
  return spots;
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
// sample; a stock leg at the sample itself; both against the leg's entry premium, exactly as
// the expiry curve. Null when any option leg has no model value (no volatility, a model that
// did not price, or an expiry already passed): the curve is omitted, never invented.
export function computePayoffNow(
  legs: readonly PricedLeg[],
  spot: DecimalString,
  expiryUnderlyings: readonly DecimalString[],
  riskFreeRate: DecimalString,
  dividendYield: DecimalString,
): PayoffPoint[] | null {
  if (legs.some((leg) => leg.valuation.leg.role !== "stock" && leg.model === null)) return null;

  const unique = new Map<string, Decimal>();
  for (const s of [
    ...expiryUnderlyings.map((u) => parseDecimal(u)),
    ...gridSpots(parseDecimal(spot)),
  ]) {
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
