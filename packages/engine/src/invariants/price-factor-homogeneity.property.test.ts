import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { decimalString, quantity } from "../test/support";
import { bsmPriceRaw } from "../internal/black-scholes";
import { priceOptionLeg } from "../internal/option-pricing";

// ADR-0063 / #307: BSM's own fair value is homogeneous of degree one in (spot, strike) —
// V(cS, cK) = c * V(S, K) for any c > 0 — which is exactly what lets a series' own
// `priceFactor` stay a pure seam-local conversion (ADR-0013's frozen pricing model is
// untouched) rather than a second pricing model. Two independent checks of that, both from
// the ticket's own wording: (1) the same market read on a rescaled (spot/f, strike/f) solves
// the same implied volatility and delta as the unscaled run at factor f, since both are
// unit-free under a joint (S, K) rescaling — gamma is also checked there, scaled by `factor`
// rather than left unscaled, since it is homogeneous of degree -1, not 0 like delta; (2) every
// money-valued output but gamma (fairValue, theta, vega, rho) at factor f equals the
// factor-less run on the same (unscaled) spot/strike, divided by f — gamma stays excluded from
// this second check (pinned by its own fixed-number test in option-pricing.test.ts instead),
// since it is also homogeneous of degree -1, not +1.
//
// Check (2)'s tolerance is a worst-case bound on rounding noise, not a guess: each side rounds
// independently to the reported scale (PRICE_SCALE 2 for fairValue, RATIO_SCALE 6 for a greek,
// decimal.ts) before this test ever sees it — round(raw/f) vs round(raw)/f differ by at most
// one rounding step on each side, i.e. half a unit of the reported scale times (1 + 1/f), which
// is at most one whole unit of that scale since f >= 1.
const PRICE_SCALE_TOLERANCE = 0.011;
const RATIO_SCALE_TOLERANCE = 2e-6;

const leg = {
  role: "call" as const,
  side: "buy" as const,
  ticker: "IDXC100",
  quantity: quantity(1),
};

const reasonableInputs = fc.record({
  spot: fc.double({ min: 50, max: 250, noNaN: true }),
  strike: fc.double({ min: 50, max: 250, noNaN: true }),
  sigma: fc.double({ min: 0.1, max: 0.8, noNaN: true }),
  t: fc.double({ min: 0.08, max: 1.5, noNaN: true }),
  r: fc.double({ min: -0.02, max: 0.2, noNaN: true }),
  q: fc.double({ min: 0, max: 0.1, noNaN: true }),
  factor: fc.double({ min: 1, max: 200, noNaN: true }),
});

describe("priceFactor homogeneity (property, #307)", () => {
  it("solves the same implied volatility and delta as the f=1 run on (spot/f, strike/f, premium)", () => {
    fc.assert(
      fc.property(reasonableInputs, ({ spot, strike, sigma, t, r, q, factor }) => {
        const pointsPrice = bsmPriceRaw({ s: spot, k: strike, t, r, q, sigma, right: "call" });
        fc.pre(Number.isFinite(pointsPrice) && pointsPrice > 1);
        const storedPremium = decimalString((pointsPrice / factor).toFixed(8));

        const runFactor = priceOptionLeg({
          leg,
          strike: decimalString(strike.toFixed(8)),
          spot: decimalString(spot.toFixed(8)),
          riskFreeRate: decimalString(r.toFixed(8)),
          dividendYield: decimalString(q.toFixed(8)),
          timeToExpiryYears: t,
          marketPrice: { value: storedPremium, source: "close", stale: null },
          givenVolatility: null,
          priceFactor: decimalString(factor.toFixed(8)),
        });
        const runRescaled = priceOptionLeg({
          leg,
          strike: decimalString((strike / factor).toFixed(8)),
          spot: decimalString((spot / factor).toFixed(8)),
          riskFreeRate: decimalString(r.toFixed(8)),
          dividendYield: decimalString(q.toFixed(8)),
          timeToExpiryYears: t,
          marketPrice: { value: storedPremium, source: "close", stale: null },
          givenVolatility: null,
        });

        fc.pre(runFactor.impliedVolatility !== null && runRescaled.impliedVolatility !== null);
        // Review round 2 (correctness, blocking): measured up to 8.8e-5 over 20 000 cases on a
        // deep-ITM call with small vega (spot 214.60, strike 73.75, sigma 0.68, t 0.156, factor
        // ~1), where the IV solver's own sensitivity to the one-step-rounded stored premium is
        // largest; 2e-4 is a real bound confirmed at that sample size, not a guess.
        expect(
          Math.abs(Number(runFactor.impliedVolatility) - Number(runRescaled.impliedVolatility)),
        ).toBeLessThanOrEqual(2e-4);
        expect(
          Math.abs(Number(runFactor.greeks?.delta) - Number(runRescaled.greeks?.delta)),
        ).toBeLessThanOrEqual(5e-5);
        // Gamma (d(delta)/dS, homogeneous of degree -1): scaling (S, K) down by `factor`
        // scales gamma up by `factor` (review round 1, item 3). Both sides round their own
        // gamma to RATIO_SCALE independently before this test sees them, and the factor-run's
        // rounding error is amplified by `factor` once multiplied through, so the tolerance
        // grows with it rather than staying fixed.
        fc.pre(runFactor.greeks?.gamma !== undefined && runRescaled.greeks?.gamma !== undefined);
        expect(
          Math.abs(Number(runFactor.greeks.gamma) * factor - Number(runRescaled.greeks.gamma)),
        ).toBeLessThanOrEqual(RATIO_SCALE_TOLERANCE * (1 + factor));
      }),
      { numRuns: 200 },
    );
  });

  it("scales fairValue/theta/vega/rho by 1/priceFactor against the f=1 run on the same unscaled spot/strike; leaves delta unscaled", () => {
    fc.assert(
      fc.property(reasonableInputs, ({ spot, strike, sigma, t, r, q, factor }) => {
        const runFactor = priceOptionLeg({
          leg,
          strike: decimalString(strike.toFixed(8)),
          spot: decimalString(spot.toFixed(8)),
          riskFreeRate: decimalString(r.toFixed(8)),
          dividendYield: decimalString(q.toFixed(8)),
          timeToExpiryYears: t,
          marketPrice: null,
          givenVolatility: decimalString(sigma.toFixed(8)),
          priceFactor: decimalString(factor.toFixed(8)),
        });
        const runPoints = priceOptionLeg({
          leg,
          strike: decimalString(strike.toFixed(8)),
          spot: decimalString(spot.toFixed(8)),
          riskFreeRate: decimalString(r.toFixed(8)),
          dividendYield: decimalString(q.toFixed(8)),
          timeToExpiryYears: t,
          marketPrice: null,
          givenVolatility: decimalString(sigma.toFixed(8)),
        });

        fc.pre(runFactor.fairValue !== null && runPoints.fairValue !== null);
        expect(
          Math.abs(Number(runFactor.fairValue) - Number(runPoints.fairValue) / factor),
        ).toBeLessThanOrEqual(PRICE_SCALE_TOLERANCE);
        expect(
          Math.abs(Number(runFactor.greeks?.theta) - Number(runPoints.greeks?.theta) / factor),
        ).toBeLessThanOrEqual(RATIO_SCALE_TOLERANCE);
        expect(
          Math.abs(Number(runFactor.greeks?.vega) - Number(runPoints.greeks?.vega) / factor),
        ).toBeLessThanOrEqual(RATIO_SCALE_TOLERANCE);
        expect(
          Math.abs(Number(runFactor.greeks?.rho) - Number(runPoints.greeks?.rho) / factor),
        ).toBeLessThanOrEqual(RATIO_SCALE_TOLERANCE);
        expect(
          Math.abs(Number(runFactor.greeks?.delta) - Number(runPoints.greeks?.delta)),
        ).toBeLessThanOrEqual(RATIO_SCALE_TOLERANCE);
      }),
      { numRuns: 200 },
    );
  });
});
