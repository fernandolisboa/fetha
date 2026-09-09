import { bsmGreeksRaw, bsmPriceRaw, type BsmInput } from "./black-scholes";

export type ImpliedVolatilityInput = Omit<BsmInput, "sigma"> & { price: number };

export type ImpliedVolatilityResult = { ok: true; sigma: number } | { ok: false };

const LOWER_SIGMA = 1e-4;
const UPPER_SIGMA = 5;
const PRICE_TOLERANCE = 1e-8;
const MAX_ITERATIONS = 100;

// A price match within PRICE_TOLERANCE is not, on its own, evidence the root is pinned:
// deep in/out of the money near expiry, price is near-flat across almost the whole sigma
// domain, so bisection can satisfy the tolerance inside a bracket that never meaningfully
// narrowed. Two independent signals of that: the local vega at the accepted sigma (how
// much price moves per unit sigma there) and the price spanned by the accepted bracket's
// endpoints (how much price moved across the whole interval that was searched). Both
// thresholds were picked from the gap between well-conditioned fixtures (Hull ch.19-style,
// vega ~5-10, bracket price width ~0.8-1.5) and the near-intrinsic case above (vega
// <1e-3, bracket price width <1e-4): two orders of magnitude of headroom on each side
// (PR #53 round 1 item 16).
const MIN_VEGA_AT_SOLUTION = 1e-3;
const MIN_BRACKET_PRICE_WIDTH = 1e-4;

function intrinsicLowerBound(input: ImpliedVolatilityInput): number {
  const { s, k, t, r, q, right } = input;
  const forward = s * Math.exp(-q * t);
  const discountedStrike = k * Math.exp(-r * t);
  return right === "call"
    ? Math.max(forward - discountedStrike, 0)
    : Math.max(discountedStrike - forward, 0);
}

// Newton-Raphson on vega, falling back to bisection whenever a step leaves the bracket
// (vega can be near zero deep in or out of the money, which makes plain Newton diverge).
export function solveImpliedVolatilityRaw(input: ImpliedVolatilityInput): ImpliedVolatilityResult {
  const { price, ...bsmBase } = input;
  if (!Number.isFinite(price) || price <= intrinsicLowerBound(input) + 1e-12) {
    return { ok: false };
  }

  const priceAt = (sigma: number): number => bsmPriceRaw({ ...bsmBase, sigma });
  const upperPrice = priceAt(UPPER_SIGMA);
  if (price >= upperPrice) return { ok: false };

  const accept = (
    candidate: number,
    bracketLow: number,
    bracketHigh: number,
  ): ImpliedVolatilityResult => {
    const vega = bsmGreeksRaw({ ...bsmBase, sigma: candidate }).vega;
    const bracketPriceWidth = Math.abs(priceAt(bracketHigh) - priceAt(bracketLow));
    const reliable = vega >= MIN_VEGA_AT_SOLUTION && bracketPriceWidth >= MIN_BRACKET_PRICE_WIDTH;
    return reliable ? { ok: true, sigma: candidate } : { ok: false };
  };

  let low = LOWER_SIGMA;
  let high = UPPER_SIGMA;
  let sigma =
    Math.sqrt((2 * Math.PI) / Math.max(bsmBase.t, 1e-9)) * (price / Math.max(bsmBase.s, 1e-9));
  sigma = Math.min(Math.max(sigma, low), high);

  for (let i = 0; i < MAX_ITERATIONS; i += 1) {
    const currentPrice = priceAt(sigma);
    const diff = currentPrice - price;
    if (Math.abs(diff) < PRICE_TOLERANCE) return accept(sigma, low, high);

    if (diff > 0) high = sigma;
    else low = sigma;

    const vega = bsmGreeksRaw({ ...bsmBase, sigma }).vega;
    let next = vega > 1e-8 ? sigma - diff / vega : Number.NaN;
    if (!Number.isFinite(next) || next <= low || next >= high) {
      next = (low + high) / 2;
    }
    sigma = next;
  }

  const finalDiff = priceAt(sigma) - price;
  return Math.abs(finalDiff) < 1e-4 ? accept(sigma, low, high) : { ok: false };
}
