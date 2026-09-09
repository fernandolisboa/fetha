import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { bsmPriceRaw } from "./black-scholes";
import { solveImpliedVolatilityRaw } from "./implied-volatility";

describe("solveImpliedVolatilityRaw", () => {
  it("round-trips price -> iv -> price for the Hull S0=42, K=40, r=10%, T=0.5 example", () => {
    const sigma = 0.2;
    const params = { s: 42, k: 40, t: 0.5, r: 0.1, q: 0, right: "call" as const };
    const price = bsmPriceRaw({ ...params, sigma });
    const solved = solveImpliedVolatilityRaw({ ...params, price });
    expect(solved.ok).toBe(true);
    if (solved.ok) {
      expect(solved.sigma).toBeCloseTo(sigma, 4);
      const repriced = bsmPriceRaw({ ...params, sigma: solved.sigma });
      expect(repriced).toBeCloseTo(price, 6);
    }
  });

  it("fails when the price is at or above the price implied by the upper volatility bound", () => {
    const params = { s: 42, k: 40, t: 0.5, r: 0.1, q: 0, right: "call" as const };
    const upperPrice = bsmPriceRaw({ ...params, sigma: 5 });
    const solved = solveImpliedVolatilityRaw({ ...params, price: upperPrice + 1 });
    expect(solved.ok).toBe(false);
  });

  it("fails on a non-finite price", () => {
    const solved = solveImpliedVolatilityRaw({
      s: 42,
      k: 40,
      t: 0.5,
      r: 0.1,
      q: 0,
      right: "call",
      price: Number.NaN,
    });
    expect(solved.ok).toBe(false);
  });

  it("fails to converge on a price below intrinsic value (arbitrage-violating)", () => {
    const solved = solveImpliedVolatilityRaw({
      s: 42,
      k: 40,
      t: 0.5,
      r: 0.1,
      q: 0,
      right: "call",
      price: 1, // intrinsic lower bound (S - K e^-rT) is well above 1
    });
    expect(solved.ok).toBe(false);
  });

  it("fails to converge on a deep-in-the-money, near-expiry call whose price is near-flat in sigma", () => {
    // Deep ITM with days to expiry: vega is negligible everywhere in the sigma domain, so
    // the bisection can satisfy the price tolerance at almost any point in a wide bracket
    // (PR #53 round 1 item 16) — the "solution" is not actually pinned by the price.
    const params = { s: 100, k: 50, t: 0.02, r: 0.1, q: 0, right: "call" as const };
    const price = bsmPriceRaw({ ...params, sigma: 1 });
    const solved = solveImpliedVolatilityRaw({ ...params, price });
    expect(solved.ok).toBe(false);
  });

  it("round-trips for puts too", () => {
    const sigma = 0.35;
    const params = { s: 30, k: 32, t: 0.25, r: 0.08, q: 0.02, right: "put" as const };
    const price = bsmPriceRaw({ ...params, sigma });
    const solved = solveImpliedVolatilityRaw({ ...params, price });
    expect(solved.ok).toBe(true);
    if (solved.ok) expect(solved.sigma).toBeCloseTo(sigma, 4);
  });

  it("round-trips price -> iv -> price for arbitrary well-formed inputs (property)", () => {
    fc.assert(
      fc.property(
        fc.double({ min: 5, max: 200, noNaN: true }),
        fc.double({ min: 5, max: 200, noNaN: true }),
        fc.double({ min: 0.02, max: 3, noNaN: true }),
        fc.double({ min: 0, max: 0.2, noNaN: true }),
        fc.double({ min: 0, max: 0.1, noNaN: true }),
        fc.double({ min: 0.02, max: 1.5, noNaN: true }),
        fc.constantFrom("call", "put"),
        (s, k, t, r, q, sigma, right) => {
          const price = bsmPriceRaw({ s, k, t, r, q, sigma, right });
          const solved = solveImpliedVolatilityRaw({ s, k, t, r, q, right, price });
          if (!solved.ok) return true;
          const repriced = bsmPriceRaw({ s, k, t, r, q, sigma: solved.sigma, right });
          expect(Math.abs(repriced - price)).toBeLessThan(1e-4);
          return true;
        },
      ),
      { numRuns: 200 },
    );
  });
});
