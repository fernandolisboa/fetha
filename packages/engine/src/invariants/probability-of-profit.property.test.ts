import Decimal from "decimal.js";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { DecimalString } from "@fetha/contracts";
import type { LegValuation } from "../api";
import { decimalString, quantity } from "../test/support";
import { payoffAt, type PricedLeg } from "../internal/payoff-at";
import { computePayoffProfile } from "../internal/price-operation";
import { computeProbabilityOfProfit } from "../internal/probability-of-profit";

const RISK_FREE_RATE = decimalString("0.139762");
const DIVIDEND_YIELD = decimalString("0");

type LegSpec = {
  right: "call" | "put" | "stock";
  side: "buy" | "sell";
  strike: number;
  premium: number;
  qty: number;
  sigma: number;
};

function legValuation(
  role: "call" | "put" | "stock",
  side: "buy" | "sell",
  ticker: string,
  qty: number,
): LegValuation {
  return {
    leg: { role, side, ticker, quantity: quantity(qty) },
    price: decimalString("1.00"),
    priceSource: "given",
    stale: null,
    fairValue: null,
    impliedVolatility: null,
    volatilitySource: "given",
    greeks: null,
    timeToExpiryYears: null,
    notes: [],
  };
}

function buildLegs(specs: readonly LegSpec[], t: number): PricedLeg[] {
  return specs.map((spec, index) => ({
    valuation: legValuation(spec.right, spec.side, `L${String(index)}`, spec.qty),
    strike: spec.right === "stock" ? null : decimalString(spec.strike.toFixed(2)),
    premiumPerUnit: new Decimal(spec.premium.toFixed(2)),
    priceFactor: new Decimal(1),
    model: spec.right === "stock" ? null : { sigma: spec.sigma, timeToExpiryYears: t },
  }));
}

function mirror(specs: readonly LegSpec[]): LegSpec[] {
  return specs.map((spec) => ({ ...spec, side: spec.side === "buy" ? "sell" : "buy" }));
}

// ADR-0082 "A zero plateau... counts as no profit": the same interval construction
// `computeProbabilityOfProfit` itself probes (0 and every break-even as interval ends, the
// midpoint of each bounded interval and twice-the-last-plus-one for the tail), checking for an
// exact zero there rather than a strictly positive sign. Every break-even is itself a zero
// crossing, so `payoffAt` at a break-even is always (near) zero by construction — probing only
// the interval's own midpoint, never its endpoints, is what tells a genuine flat-zero interval
// (test 9's debit-at-width plateau) apart from an ordinary sign change at its edge.
function hasZeroPlateau(legs: readonly PricedLeg[], breakEvens: readonly DecimalString[]): boolean {
  const points = [0, ...breakEvens.map(Number)].sort((a, b) => a - b);
  for (let i = 0; i < points.length; i += 1) {
    const lo = points[i] as number;
    const hasUpperBound = i + 1 < points.length;
    const hi = hasUpperBound ? (points[i + 1] as number) : null;
    const probe = hi !== null ? new Decimal(lo).add(hi).div(2) : new Decimal(lo).mul(2).add(1);
    if (payoffAt(legs, probe).isZero()) return true;
  }
  return false;
}

function priceAndProbability(specs: readonly LegSpec[], spot: number, t: number) {
  const legs = buildLegs(specs, t);
  const spotString = decimalString(spot.toFixed(2));
  const { breakEvens } = computePayoffProfile(legs, spotString);
  const probability = computeProbabilityOfProfit(
    legs,
    spotString,
    breakEvens,
    RISK_FREE_RATE,
    DIVIDEND_YIELD,
  );
  return { legs, breakEvens, probability };
}

const strikeArb = fc.integer({ min: 1000, max: 5000 }).map((c) => c / 100);
const sigmaArb = fc.double({ min: 0.05, max: 1.0, noNaN: true });
const premiumArb = fc.integer({ min: 1, max: 1000 }).map((c) => c / 100);
const qtyArb = fc.integer({ min: 1, max: 100 });
const sideArb = fc.constantFrom<"buy" | "sell">("buy", "sell");
const rightArb = fc.constantFrom<"call" | "put">("call", "put");
const spotArb = fc.integer({ min: 1000, max: 5000 }).map((c) => c / 100);
const tArb = fc.double({ min: 1 / 252, max: 1.5, noNaN: true });

const legSpecArb: fc.Arbitrary<LegSpec> = fc.record({
  right: rightArb,
  side: sideArb,
  strike: strikeArb,
  premium: premiumArb,
  qty: qtyArb,
  sigma: sigmaArb,
});

// ADR-0082's own "covered calls" family (a stock leg contributes no sigma, the slope at
// infinity it sets is what caps the structure's max gain): long stock against a short call at
// its own strike, both at the same quantity, so this never builds a position with a fractional
// covered leg.
function coveredCallArb(sigmaFloor: number): fc.Arbitrary<LegSpec[]> {
  return fc
    .record({
      stockEntry: strikeArb,
      callStrike: strikeArb,
      callPremium: premiumArb,
      qty: qtyArb,
      sigma: fc.double({ min: sigmaFloor, max: 1.0, noNaN: true }),
    })
    .map(({ stockEntry, callStrike, callPremium, qty, sigma }) => [
      { right: "stock", side: "buy", strike: 0, premium: stockEntry, qty, sigma: 0 },
      { right: "call", side: "sell", strike: callStrike, premium: callPremium, qty, sigma },
    ]);
}

const structureArb = fc.oneof(
  fc.array(legSpecArb, { minLength: 1, maxLength: 4 }),
  coveredCallArb(0.05),
);

describe("probabilityOfProfit (property, ADR-0082)", () => {
  it("every non-null probability is a canonical 4-place DecimalString in [0, 1]", () => {
    fc.assert(
      fc.property(structureArb, spotArb, tArb, (specs, spot, t) => {
        const { probability } = priceAndProbability(specs, spot, t);
        if (probability === null) return;
        expect(probability.probability).toMatch(/^(0\.\d{4}|1\.0000)$/);
        const value = Number(probability.probability);
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThanOrEqual(1);
      }),
      { numRuns: 300 },
    );
  });

  it("P(O) + P(mirror of O) sums to 1 when neither payoff has a zero plateau, and never exceeds 1 otherwise", () => {
    let noPlateauCases = 0;
    let totalCases = 0;
    fc.assert(
      fc.property(structureArb, spotArb, tArb, (specs, spot, t) => {
        const forwardLegs = buildLegs(specs, t);
        const mirrorLegs = buildLegs(mirror(specs), t);
        const spotString = decimalString(spot.toFixed(2));
        const forwardBreakEvens = computePayoffProfile(forwardLegs, spotString).breakEvens;
        const mirrorBreakEvens = computePayoffProfile(mirrorLegs, spotString).breakEvens;
        const forward = computeProbabilityOfProfit(
          forwardLegs,
          spotString,
          forwardBreakEvens,
          RISK_FREE_RATE,
          DIVIDEND_YIELD,
        );
        const mirrored = computeProbabilityOfProfit(
          mirrorLegs,
          spotString,
          mirrorBreakEvens,
          RISK_FREE_RATE,
          DIVIDEND_YIELD,
        );
        if (forward === null || mirrored === null) return;
        totalCases += 1;
        const sum = Number(forward.probability) + Number(mirrored.probability);
        const plateau =
          hasZeroPlateau(forwardLegs, forwardBreakEvens) ||
          hasZeroPlateau(mirrorLegs, mirrorBreakEvens);
        if (!plateau) {
          noPlateauCases += 1;
          expect(Math.abs(sum - 1)).toBeLessThanOrEqual(1e-4);
        } else {
          expect(sum).toBeLessThanOrEqual(1 + 1e-9);
        }
      }),
      { numRuns: 300 },
    );
    // Confirms the equality branch actually runs on most generated cases, not just the loose
    // plateau fallback: a zero plateau needs a very specific numeric coincidence (a credit or
    // debit landing exactly on a spread's width), vanishingly unlikely over randomly generated
    // cents, so it should fire on nearly every non-null case.
    expect(noPlateauCases).toBeGreaterThan(totalCases * 0.9);
  });

  it("is invariant to the order the legs are given in", () => {
    fc.assert(
      fc.property(
        fc.oneof(fc.array(legSpecArb, { minLength: 2, maxLength: 4 }), coveredCallArb(0.05)),
        spotArb,
        tArb,
        (specs, spot, t) => {
          const legs = buildLegs(specs, t);
          const spotString = decimalString(spot.toFixed(2));
          const { breakEvens } = computePayoffProfile(legs, spotString);
          const forward = computeProbabilityOfProfit(
            legs,
            spotString,
            breakEvens,
            RISK_FREE_RATE,
            DIVIDEND_YIELD,
          );
          const reversedLegs = [...legs].reverse();
          const reversedBreakEvens = computePayoffProfile(reversedLegs, spotString).breakEvens;
          const reversed = computeProbabilityOfProfit(
            reversedLegs,
            spotString,
            reversedBreakEvens,
            RISK_FREE_RATE,
            DIVIDEND_YIELD,
          );
          expect(reversed).toEqual(forward);
        },
      ),
      { numRuns: 300 },
    );
  });

  it("multiplying every quantity by k leaves the probability unchanged", () => {
    fc.assert(
      fc.property(
        structureArb,
        spotArb,
        tArb,
        fc.integer({ min: 1, max: 20 }),
        (specs, spot, t, k) => {
          const base = priceAndProbability(specs, spot, t);
          const scaled = priceAndProbability(
            specs.map((s) => ({ ...s, qty: s.qty * k })),
            spot,
            t,
          );
          expect(scaled.probability).toEqual(base.probability);
        },
      ),
      { numRuns: 300 },
    );
  });

  // A low sigma combined with a short T makes the lognormal CDF extremely steep (its density
  // scales with 1/(sigma*sqrt(t))), so the half-cent rounding `computePayoffProfile` already
  // applies to every break-even (PRICE_SCALE) gets amplified far out of proportion once this
  // test's own `k` scaling folds it back out — a real property of rounding, not of this
  // function, and not the point this property is checking. A gentler sigma/T floor keeps the
  // check meaningful without chasing that amplification.
  const stableLegSpecArb: fc.Arbitrary<LegSpec> = fc.record({
    right: rightArb,
    side: sideArb,
    strike: strikeArb,
    premium: premiumArb,
    qty: qtyArb,
    sigma: fc.double({ min: 0.15, max: 1.0, noNaN: true }),
  });
  const stableStructureArb = fc.oneof(
    fc.array(stableLegSpecArb, { minLength: 1, maxLength: 4 }),
    coveredCallArb(0.15),
  );
  const stableTArb = fc.double({ min: 10 / 252, max: 1.5, noNaN: true });

  it("multiplying spot, strikes and premiums by the same positive integer leaves the probability unchanged", () => {
    fc.assert(
      fc.property(
        stableStructureArb,
        spotArb,
        stableTArb,
        fc.integer({ min: 1, max: 10 }),
        (specs, spot, t, k) => {
          const base = priceAndProbability(specs, spot, t);
          const scaled = priceAndProbability(
            specs.map((s) => ({ ...s, strike: s.strike * k, premium: s.premium * k })),
            spot * k,
            t,
          );
          if (base.probability === null || scaled.probability === null) {
            expect(scaled.probability).toEqual(base.probability);
            return;
          }
          // computePayoffProfile rounds each break-even to PRICE_SCALE before this function
          // ever sees it (ADR-0082's own "exact" reading of a break-even), so a break-even that
          // round-trips through `k * round(x)` versus `round(k * x)` can differ by up to half a
          // cent. The density the lognormal CDF turns that into is at most `f(breakEven) *
          // 0.005` per break-even (the same bound ADR-0082 itself gives, "Using the reported
          // break-evens"), not a fixed fraction of a basis point — negligible next to this
          // property's own point, but not as tight as "well under one part in ten thousand".
          expect(
            Math.abs(Number(scaled.probability.probability) - Number(base.probability.probability)),
          ).toBeLessThanOrEqual(3e-3);
          expect(scaled.probability.volatility).toBe(base.probability.volatility);
          expect(scaled.probability.volatilityFrom).toEqual(base.probability.volatilityFrom);
        },
      ),
      { numRuns: 300 },
    );
  });
});

describe("probabilityOfProfit vertical spreads (property, ADR-0082)", () => {
  const widthArb = fc.integer({ min: 100, max: 1000 }).map((c) => c / 100);

  it("a vertical priced at a net credit, payoff positive everywhere, gives 1.0000", () => {
    fc.assert(
      fc.property(
        strikeArb,
        widthArb,
        sigmaArb,
        tArb,
        spotArb,
        (lowStrike, width, sigma, t, spot) => {
          const highStrike = lowStrike + width;
          const credit = width + 0.01;
          const specs: LegSpec[] = [
            { right: "call", side: "buy", strike: lowStrike, premium: 0, qty: 1, sigma },
            { right: "call", side: "sell", strike: highStrike, premium: credit, qty: 1, sigma },
          ];
          const { probability } = priceAndProbability(specs, spot, t);
          expect(probability?.probability).toBe("1.0000");
        },
      ),
      { numRuns: 200 },
    );
  });

  it("a debit at or above the vertical's width gives 0.0000", () => {
    fc.assert(
      fc.property(
        strikeArb,
        widthArb,
        sigmaArb,
        tArb,
        spotArb,
        (lowStrike, width, sigma, t, spot) => {
          const highStrike = lowStrike + width;
          const specs: LegSpec[] = [
            { right: "call", side: "buy", strike: lowStrike, premium: width, qty: 1, sigma },
            { right: "call", side: "sell", strike: highStrike, premium: 0, qty: 1, sigma },
          ];
          const { probability } = priceAndProbability(specs, spot, t);
          expect(probability?.probability).toBe("0.0000");
        },
      ),
      { numRuns: 200 },
    );
  });
});

describe("probabilityOfProfit monotonicity (property, ADR-0082)", () => {
  it("raising a long call's premium (moving its break-even up) never raises the probability", () => {
    fc.assert(
      fc.property(
        strikeArb,
        sigmaArb,
        tArb,
        spotArb,
        fc.integer({ min: 1, max: 500 }),
        fc.integer({ min: 1, max: 500 }),
        (strike, sigma, t, spot, lowCents, deltaCents) => {
          const lowPremium = lowCents / 100;
          const highPremium = (lowCents + deltaCents) / 100;
          const low = priceAndProbability(
            [{ right: "call", side: "buy", strike, premium: lowPremium, qty: 1, sigma }],
            spot,
            t,
          );
          const high = priceAndProbability(
            [{ right: "call", side: "buy", strike, premium: highPremium, qty: 1, sigma }],
            spot,
            t,
          );
          if (low.probability === null || high.probability === null) return;
          expect(Number(high.probability.probability)).toBeLessThanOrEqual(
            Number(low.probability.probability) + 1e-9,
          );
        },
      ),
      { numRuns: 300 },
    );
  });

  // A long put's own break-even is `strike - premium`: *lowering* its premium is what moves
  // that break-even *up* (ADR-0082's own "moving the break-even up" reading, mirrored from the
  // call case above, not a literal "raising the premium" for the put — raising a put's premium
  // moves its break-even down, the same direction a call's own break-even moves when its
  // premium is lowered). The put's profit region is `(0, break-even)`, so `P = F(break-even)`
  // rises with its own break-even: never lowered by moving it up.
  it("lowering a long put's premium (moving its break-even up) never lowers the probability", () => {
    fc.assert(
      fc.property(
        strikeArb,
        sigmaArb,
        tArb,
        spotArb,
        fc.integer({ min: 1, max: 500 }),
        fc.integer({ min: 1, max: 500 }),
        (strike, sigma, t, spot, lowCents, deltaCents) => {
          const higherPremium = lowCents / 100;
          const lowerPremium = Math.max(0, lowCents - deltaCents) / 100;
          const lowerBreakEven = priceAndProbability(
            [{ right: "put", side: "buy", strike, premium: higherPremium, qty: 1, sigma }],
            spot,
            t,
          );
          const higherBreakEven = priceAndProbability(
            [{ right: "put", side: "buy", strike, premium: lowerPremium, qty: 1, sigma }],
            spot,
            t,
          );
          if (lowerBreakEven.probability === null || higherBreakEven.probability === null) return;
          expect(Number(higherBreakEven.probability.probability)).toBeGreaterThanOrEqual(
            Number(lowerBreakEven.probability.probability) - 1e-9,
          );
        },
      ),
      { numRuns: 300 },
    );
  });
});
