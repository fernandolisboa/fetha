import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { bsmGreeksRaw, bsmPriceRaw } from "./black-scholes";

const bsmParamsArb = fc.record({
  s: fc.double({ min: 5, max: 200, noNaN: true }),
  k: fc.double({ min: 5, max: 200, noNaN: true }),
  t: fc.double({ min: 0.02, max: 3, noNaN: true }),
  r: fc.double({ min: 0, max: 0.2, noNaN: true }),
  q: fc.double({ min: 0, max: 0.1, noNaN: true }),
  sigma: fc.double({ min: 0.02, max: 1.5, noNaN: true }),
  right: fc.constantFrom("call" as const, "put" as const),
});

// Hull, Options, Futures, and Other Derivatives: the standard non-dividend-paying example
// S0 = $42, K = $40, r = 10% p.a., sigma = 20% p.a., T = 0.5 years, used for both the
// Black-Scholes-Merton price (ch. 15) and the Greek letters (ch. 19). c ~= 4.76, p ~= 0.81.
const hullS = 42;
const hullK = 40;
const hullR = 0.1;
const hullQ = 0;
const hullSigma = 0.2;
const hullT = 0.5;

describe("bsmPriceRaw (Hull S0=42, K=40, r=10%, sigma=20%, T=0.5)", () => {
  it("prices the call near Hull's $4.76", () => {
    const call = bsmPriceRaw({
      s: hullS,
      k: hullK,
      t: hullT,
      r: hullR,
      q: hullQ,
      sigma: hullSigma,
      right: "call",
    });
    expect(call).toBeCloseTo(4.76, 2);
  });

  it("prices the put near Hull's $0.81", () => {
    const put = bsmPriceRaw({
      s: hullS,
      k: hullK,
      t: hullT,
      r: hullR,
      q: hullQ,
      sigma: hullSigma,
      right: "put",
    });
    expect(put).toBeCloseTo(0.81, 2);
  });

  it("satisfies put-call parity: c - p = S*e^-qT - K*e^-rT", () => {
    const call = bsmPriceRaw({
      s: hullS,
      k: hullK,
      t: hullT,
      r: hullR,
      q: hullQ,
      sigma: hullSigma,
      right: "call",
    });
    const put = bsmPriceRaw({
      s: hullS,
      k: hullK,
      t: hullT,
      r: hullR,
      q: hullQ,
      sigma: hullSigma,
      right: "put",
    });
    const forwardDiff = hullS * Math.exp(-hullQ * hullT) - hullK * Math.exp(-hullR * hullT);
    expect(call - put).toBeCloseTo(forwardDiff, 6);
  });

  it("converges to intrinsic value as T approaches zero", () => {
    const call = bsmPriceRaw({
      s: 45,
      k: 40,
      t: 1e-9,
      r: hullR,
      q: hullQ,
      sigma: hullSigma,
      right: "call",
    });
    expect(call).toBeCloseTo(5, 2);
    const put = bsmPriceRaw({
      s: 35,
      k: 40,
      t: 1e-9,
      r: hullR,
      q: hullQ,
      sigma: hullSigma,
      right: "put",
    });
    expect(put).toBeCloseTo(5, 2);
  });
});

describe("bsmGreeksRaw (Hull ch. 19, same S0=42, K=40, r=10%, sigma=20%, T=0.5 example)", () => {
  it("computes call delta near Hull's N(d1) = 0.7791", () => {
    const greeks = bsmGreeksRaw({
      s: hullS,
      k: hullK,
      t: hullT,
      r: hullR,
      q: hullQ,
      sigma: hullSigma,
      right: "call",
    });
    expect(greeks.delta).toBeCloseTo(0.7791, 3);
  });

  it("computes put delta as call delta minus one (no dividend)", () => {
    const call = bsmGreeksRaw({
      s: hullS,
      k: hullK,
      t: hullT,
      r: hullR,
      q: hullQ,
      sigma: hullSigma,
      right: "call",
    });
    const put = bsmGreeksRaw({
      s: hullS,
      k: hullK,
      t: hullT,
      r: hullR,
      q: hullQ,
      sigma: hullSigma,
      right: "put",
    });
    expect(put.delta).toBeCloseTo(call.delta - 1, 6);
  });

  it("computes call and put gamma as identical (gamma is right-independent)", () => {
    const call = bsmGreeksRaw({
      s: hullS,
      k: hullK,
      t: hullT,
      r: hullR,
      q: hullQ,
      sigma: hullSigma,
      right: "call",
    });
    const put = bsmGreeksRaw({
      s: hullS,
      k: hullK,
      t: hullT,
      r: hullR,
      q: hullQ,
      sigma: hullSigma,
      right: "put",
    });
    expect(call.gamma).toBeCloseTo(put.gamma, 6);
    expect(call.gamma).toBeCloseTo(0.0497, 3);
  });

  it("computes call and put vega as identical (vega is right-independent)", () => {
    const call = bsmGreeksRaw({
      s: hullS,
      k: hullK,
      t: hullT,
      r: hullR,
      q: hullQ,
      sigma: hullSigma,
      right: "call",
    });
    const put = bsmGreeksRaw({
      s: hullS,
      k: hullK,
      t: hullT,
      r: hullR,
      q: hullQ,
      sigma: hullSigma,
      right: "put",
    });
    expect(call.vega).toBeCloseTo(put.vega, 6);
    expect(call.vega).toBeCloseTo(8.81, 1);
  });

  it("computes a negative call theta near Hull's -4.55/year", () => {
    const greeks = bsmGreeksRaw({
      s: hullS,
      k: hullK,
      t: hullT,
      r: hullR,
      q: hullQ,
      sigma: hullSigma,
      right: "call",
    });
    expect(greeks.theta).toBeCloseTo(-4.5504, 1);
  });

  it("computes a positive call rho", () => {
    const greeks = bsmGreeksRaw({
      s: hullS,
      k: hullK,
      t: hullT,
      r: hullR,
      q: hullQ,
      sigma: hullSigma,
      right: "call",
    });
    expect(greeks.rho).toBeGreaterThan(0);
    expect(greeks.rho).toBeCloseTo(13.98, 1);
  });

  it("computes a negative put rho", () => {
    const greeks = bsmGreeksRaw({
      s: hullS,
      k: hullK,
      t: hullT,
      r: hullR,
      q: hullQ,
      sigma: hullSigma,
      right: "put",
    });
    expect(greeks.rho).toBeLessThan(0);
  });

  it("returns intrinsic-only delta of 1 for an in-the-money call at expiry (t=0)", () => {
    const greeks = bsmGreeksRaw({
      s: 45,
      k: 40,
      t: 0,
      r: hullR,
      q: hullQ,
      sigma: hullSigma,
      right: "call",
    });
    expect(greeks).toEqual({ delta: 1, gamma: 0, theta: 0, vega: 0, rho: 0 });
  });

  it("returns zero delta for an out-of-the-money call at expiry (t=0)", () => {
    const greeks = bsmGreeksRaw({
      s: 35,
      k: 40,
      t: 0,
      r: hullR,
      q: hullQ,
      sigma: hullSigma,
      right: "call",
    });
    expect(greeks.delta).toBe(0);
  });

  it("returns intrinsic-only delta of -1 for an in-the-money put at expiry (t=0)", () => {
    const greeks = bsmGreeksRaw({
      s: 35,
      k: 40,
      t: 0,
      r: hullR,
      q: hullQ,
      sigma: hullSigma,
      right: "put",
    });
    expect(greeks.delta).toBe(-1);
  });

  it("returns zero delta for an out-of-the-money put when volatility is zero", () => {
    const greeks = bsmGreeksRaw({
      s: 45,
      k: 40,
      t: hullT,
      r: hullR,
      q: hullQ,
      sigma: 0,
      right: "put",
    });
    expect(greeks.delta).toBe(0);
  });
});

describe("bsmPriceRaw at expiry (t=0), both rights", () => {
  it("prices an out-of-the-money put at zero intrinsic value", () => {
    const put = bsmPriceRaw({
      s: 45,
      k: 40,
      t: 0,
      r: hullR,
      q: hullQ,
      sigma: hullSigma,
      right: "put",
    });
    expect(put).toBe(0);
  });

  it("prices an in-the-money put at its intrinsic value", () => {
    const put = bsmPriceRaw({
      s: 35,
      k: 40,
      t: 0,
      r: hullR,
      q: hullQ,
      sigma: hullSigma,
      right: "put",
    });
    expect(put).toBe(5);
  });
});

describe("bsmPriceRaw properties (Hull ch. 15/19, arbitrary well-formed inputs)", () => {
  it("is bounded below by intrinsic value and above by the undiscounted underlying", () => {
    fc.assert(
      fc.property(bsmParamsArb, (params) => {
        const price = bsmPriceRaw(params);
        const forward = params.s * Math.exp(-params.q * params.t);
        const discountedStrike = params.k * Math.exp(-params.r * params.t);
        const intrinsic =
          params.right === "call"
            ? Math.max(forward - discountedStrike, 0)
            : Math.max(discountedStrike - forward, 0);
        const upperBound = params.right === "call" ? params.s : discountedStrike;
        const tolerance = 1e-4 * Math.max(1, params.s, intrinsic, upperBound);
        expect(price).toBeGreaterThan(intrinsic - tolerance);
        expect(price).toBeLessThan(upperBound + tolerance);
      }),
      { numRuns: 300 },
    );
  });

  it("satisfies put-call parity c - p = S e^-qT - K e^-rT for arbitrary well-formed inputs", () => {
    fc.assert(
      fc.property(bsmParamsArb, (params) => {
        const call = bsmPriceRaw({ ...params, right: "call" });
        const put = bsmPriceRaw({ ...params, right: "put" });
        const forwardDiff =
          params.s * Math.exp(-params.q * params.t) - params.k * Math.exp(-params.r * params.t);
        expect(Math.abs(call - put - forwardDiff)).toBeLessThan(1e-6);
      }),
      { numRuns: 300 },
    );
  });

  it("call price is non-decreasing in spot; put price is non-increasing in spot", () => {
    fc.assert(
      fc.property(bsmParamsArb, fc.double({ min: 0.01, max: 5, noNaN: true }), (params, bump) => {
        const bumped = { ...params, s: params.s + bump };
        const call = bsmPriceRaw({ ...params, right: "call" });
        const callBumped = bsmPriceRaw({ ...bumped, right: "call" });
        const put = bsmPriceRaw({ ...params, right: "put" });
        const putBumped = bsmPriceRaw({ ...bumped, right: "put" });
        expect(callBumped).toBeGreaterThanOrEqual(call - 1e-8);
        expect(putBumped).toBeLessThanOrEqual(put + 1e-8);
      }),
      { numRuns: 300 },
    );
  });

  it("price is non-decreasing in volatility for both rights", () => {
    fc.assert(
      fc.property(
        bsmParamsArb,
        fc.double({ min: 0.001, max: 0.5, noNaN: true }),
        (params, bump) => {
          const price = bsmPriceRaw(params);
          const bumpedPrice = bsmPriceRaw({ ...params, sigma: params.sigma + bump });
          expect(bumpedPrice).toBeGreaterThanOrEqual(price - 1e-8);
        },
      ),
      { numRuns: 300 },
    );
  });

  it("call price is non-increasing in strike; put price is non-decreasing in strike", () => {
    fc.assert(
      fc.property(bsmParamsArb, fc.double({ min: 0.01, max: 5, noNaN: true }), (params, bump) => {
        const bumped = { ...params, k: params.k + bump };
        const call = bsmPriceRaw({ ...params, right: "call" });
        const callBumped = bsmPriceRaw({ ...bumped, right: "call" });
        const put = bsmPriceRaw({ ...params, right: "put" });
        const putBumped = bsmPriceRaw({ ...bumped, right: "put" });
        expect(callBumped).toBeLessThanOrEqual(call + 1e-8);
        expect(putBumped).toBeGreaterThanOrEqual(put - 1e-8);
      }),
      { numRuns: 300 },
    );
  });
});
