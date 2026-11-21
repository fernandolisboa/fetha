import Decimal from "decimal.js";
import type { DecimalString, Ticker } from "@fetha/contracts";
import type { ProbabilityOfProfit } from "../api";
import { normalCdf } from "./black-scholes";
import { PROBABILITY_SCALE, RATIO_SCALE, parseDecimal, toDecimalString } from "./decimal";
import { assertDefined } from "./invariant";
import type { OptionLegModel } from "./option-pricing";
import { payoffAt, type PricedLeg } from "./price-operation";

type ModeledLeg = PricedLeg & { strike: DecimalString; model: OptionLegModel };

// A leg's premium is real only when it reflects what was actually paid or received: a given
// or market price, or a solved fair value. `valueOneLeg` defaults an unpriced leg's premium to
// zero rather than leaving it undefined, so that default has to be detected here instead
// (ADR-0082 "Premiums are real").
function hasRealPremium(leg: PricedLeg): boolean {
  return leg.valuation.price !== null || leg.valuation.fairValue !== null;
}

function isModeledOption(leg: PricedLeg): leg is ModeledLeg {
  return leg.valuation.leg.role !== "stock" && leg.model !== null && leg.strike !== null;
}

function cdfAt(x: number, s: number, r: number, q: number, sigma: number, t: number): number {
  if (x <= 0) return 0;
  const numerator = Math.log(x / s) - (r - q - 0.5 * sigma * sigma) * t;
  const denominator = sigma * Math.sqrt(t);
  return normalCdf(numerator / denominator);
}

// ADR-0082 "Profit region": sums F(b_{i+1}) - F(b_i) over every interval between consecutive
// break-evens (0 and +Infinity added at the ends) whose own sign probe is strictly positive.
function profitProbability(
  legs: readonly PricedLeg[],
  breakEvens: readonly DecimalString[],
  s: number,
  r: number,
  q: number,
  sigma: number,
  t: number,
): number {
  const points = [0, ...breakEvens.map(Number)].sort((a, b) => a - b);
  let probability = 0;
  for (let i = 0; i < points.length; i += 1) {
    const lo = assertDefined(points[i], "probability-of-profit: index within bounds");
    const hasUpperBound = i + 1 < points.length;
    const hi = hasUpperBound
      ? assertDefined(points[i + 1], "probability-of-profit: index within bounds")
      : null;
    const probe = hi !== null ? new Decimal(lo).add(hi).div(2) : new Decimal(lo).mul(2).add(1);
    if (payoffAt(legs, probe).gt(0)) {
      const lowerCdf = cdfAt(lo, s, r, q, sigma, t);
      const upperCdf = hi !== null ? cdfAt(hi, s, r, q, sigma, t) : 1;
      probability += upperCdf - lowerCdf;
    }
  }
  return probability;
}

// ADR-0082: the model-implied probability that a priced operation's expiry payoff is strictly
// positive, over (priced legs, spot, the operation's own break-evens, the risk-free rate, the
// dividend yield). `null` with no option leg, no option leg carrying a model, option legs on
// different expiries, T = 0, or any leg whose premium was defaulted to zero for want of a
// price or a fair value.
export function computeProbabilityOfProfit(
  legs: readonly PricedLeg[],
  spot: DecimalString,
  breakEvens: readonly DecimalString[],
  riskFreeRate: DecimalString,
  dividendYield: DecimalString,
): ProbabilityOfProfit | null {
  if (legs.some((leg) => !hasRealPremium(leg))) return null;

  const optionLegsWithModel = legs.filter(isModeledOption);
  const [first, ...rest] = optionLegsWithModel;
  if (!first) return null;

  const t = first.model.timeToExpiryYears;
  if (rest.some((leg) => leg.model.timeToExpiryYears !== t)) return null;
  if (t <= 0) return null;

  const spotDecimal = parseDecimal(spot);
  const distances = optionLegsWithModel.map((leg) => ({
    leg,
    distance: parseDecimal(leg.strike).sub(spotDecimal).abs(),
  }));
  const [firstDistance, ...restDistances] = distances;
  const minDistance = assertDefined(firstDistance, "probability-of-profit: at least one leg");
  const nearestMinimum = restDistances.reduce(
    (min, d) => (d.distance.lt(min.distance) ? d : min),
    minDistance,
  ).distance;
  const nearestLegs = distances.filter((d) => d.distance.eq(nearestMinimum)).map((d) => d.leg);

  const sigma = nearestLegs.reduce((sum, leg) => sum + leg.model.sigma, 0) / nearestLegs.length;

  const volatilityFrom: Ticker[] = [
    ...new Set(nearestLegs.map((leg) => leg.valuation.leg.ticker)),
  ].sort();

  const s = Number(spot);
  const r = Number(riskFreeRate);
  const q = Number(dividendYield);

  const raw = profitProbability(legs, breakEvens, s, r, q, sigma, t);
  const clamped = Decimal.max(0, Decimal.min(1, new Decimal(raw)));

  return {
    probability: toDecimalString(clamped, PROBABILITY_SCALE),
    volatility: toDecimalString(new Decimal(sigma), RATIO_SCALE),
    volatilityFrom,
  };
}
