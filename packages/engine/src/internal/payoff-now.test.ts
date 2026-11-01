import Decimal from "decimal.js";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { LegValuation, MarketView, OptionSeries, PayoffPoint } from "../api";
import { centavos, dailyCalendar, decimalString, quantity } from "../test/support";
import { bsmPriceRaw } from "./black-scholes";
import { computePayoffNow } from "./payoff-now";
import { priceOperation, type PricedLeg } from "./price-operation";
import { resolveTimeToExpiryYears } from "./time-to-expiry";

const calendar = dailyCalendar(2, 20);
const at = "2024-01-02T21:00:00.000Z";
const expiry = "2024-01-21";
const provenanceBase = {
  engineVersion: "0.1.0",
  pricingModel: "bsm_continuous_yield" as const,
  dataVersion: null,
  datasetNotes: [],
};

function series(ticker: string, right: "call" | "put", strike: string): OptionSeries {
  return {
    ticker,
    underlying: "PETR4",
    right,
    strike: decimalString(strike),
    expiry,
    style: "european",
    asOf: at,
  };
}

function viewAt(spot: string, optionSeries: OptionSeries[]): MarketView {
  return {
    calendar,
    candles: [],
    corporateActions: [],
    optionSeries,
    optionPrices: [],
    quotes: [{ ticker: "PETR4", asOf: at, last: decimalString(spot), bid: null, ask: null }],
    macro: [{ series: "cdi", date: "2024-01-01", asOf: at, annualRate: decimalString("0.105") }],
    dividendYields: [],
    impliedVolatilityIndex: [],
  };
}

function timeToExpiry(): number {
  const tte = resolveTimeToExpiryYears(calendar, at, expiry);
  if (!tte.ok) throw new Error("fixture expiry is not in the calendar");
  return tte.years;
}

function centavosOf(reais: Decimal): number {
  return reais.mul(100).round().toNumber();
}

function pointAt(points: readonly PayoffPoint[], underlying: string): PayoffPoint | undefined {
  return points.find((p) => p.underlying === underlying);
}

describe("payoffNow through priceOperation", () => {
  it("values a long call at spot at its Black-Scholes value less the premium paid", () => {
    const result = priceOperation(
      {
        view: viewAt("42.00", [series("PETR4C40", "call", "40.00")]),
        at,
        legs: [
          {
            role: "call",
            side: "buy",
            ticker: "PETR4C40",
            quantity: quantity(100),
            price: decimalString("1.50"),
            volatility: decimalString("0.30"),
          },
        ],
      },
      provenanceBase,
    );
    if (!result.ok) throw new Error(JSON.stringify(result.error));
    const fair = bsmPriceRaw({
      s: 42,
      k: 40,
      t: timeToExpiry(),
      r: Number(result.value.riskFreeRate),
      q: 0,
      sigma: 0.3,
      right: "call",
    });
    const expected = centavosOf(new Decimal(fair).sub("1.50").mul(100));
    expect(pointAt(result.value.payoffNow ?? [], "42.00")?.pnl).toBe(centavos(expected));
    const fairValue = new Decimal(result.value.legs[0]?.fairValue ?? "NaN");
    expect(Math.abs(expected - centavosOf(fairValue.sub("1.50").mul(100)))).toBeLessThanOrEqual(50);
  });

  it("reads about zero at spot for a leg valued at its own implied volatility", () => {
    const result = priceOperation(
      {
        view: viewAt("30.00", [series("PETR4C31", "call", "31.00")]),
        at,
        legs: [
          {
            role: "call",
            side: "buy",
            ticker: "PETR4C31",
            quantity: quantity(100),
            price: decimalString("0.85"),
          },
        ],
      },
      provenanceBase,
    );
    if (!result.ok) throw new Error(JSON.stringify(result.error));
    expect(result.value.legs[0]?.volatilitySource).toBe("own_implied");
    const atSpot = pointAt(result.value.payoffNow ?? [], "30.00");
    expect(Math.abs(atSpot?.pnl ?? Number.NaN)).toBeLessThanOrEqual(1);
  });

  it("samples every expiry-curve underlying plus 41 points one percent of spot apart from 0.8x to 1.2x", () => {
    const result = priceOperation(
      {
        view: viewAt("30.00", [series("PETR4C31", "call", "31.00")]),
        at,
        legs: [
          {
            role: "call",
            side: "buy",
            ticker: "PETR4C31",
            quantity: quantity(100),
            price: decimalString("0.85"),
            volatility: decimalString("0.35"),
          },
        ],
      },
      provenanceBase,
    );
    if (!result.ok) throw new Error(JSON.stringify(result.error));
    const underlyings = (result.value.payoffNow ?? []).map((p) => p.underlying);
    for (const point of result.value.payoff) expect(underlyings).toContain(point.underlying);
    for (let i = 0; i <= 40; i += 1) {
      expect(underlyings).toContain(
        new Decimal("30")
          .mul(80 + i)
          .div(100)
          .toFixed(2),
      );
    }
    const ascending = [...underlyings].sort((a, b) => new Decimal(a).cmp(b));
    expect(underlyings).toEqual(ascending);
    expect(new Set(underlyings).size).toBe(underlyings.length);
  });

  it("is null when an option leg has no volatility to value it with", () => {
    const result = priceOperation(
      {
        view: viewAt("30.00", [series("PETR4C31", "call", "31.00")]),
        at,
        legs: [{ role: "call", side: "buy", ticker: "PETR4C31", quantity: quantity(100) }],
      },
      provenanceBase,
    );
    if (!result.ok) throw new Error(JSON.stringify(result.error));
    expect(result.value.payoffNow).toBeNull();
    expect(result.value.payoff.length).toBeGreaterThan(0);
  });

  it("is null for an operation with no option leg, where it would only repeat the expiry curve", () => {
    const result = priceOperation(
      {
        view: viewAt("30.00", []),
        at,
        legs: [
          {
            role: "stock",
            side: "buy",
            ticker: "PETR4",
            quantity: quantity(100),
            price: decimalString("29.50"),
          },
        ],
      },
      provenanceBase,
    );
    if (!result.ok) throw new Error(JSON.stringify(result.error));
    expect(result.value.payoffNow).toBeNull();
    expect(result.value.payoff.length).toBeGreaterThan(0);
  });

  it("values a covered call's stock leg at the sample itself next to the call's model value", () => {
    const result = priceOperation(
      {
        view: viewAt("30.00", [series("PETR4C31", "call", "31.00")]),
        at,
        legs: [
          {
            role: "stock",
            side: "buy",
            ticker: "PETR4",
            quantity: quantity(100),
            price: decimalString("29.50"),
          },
          {
            role: "call",
            side: "sell",
            ticker: "PETR4C31",
            quantity: quantity(100),
            price: decimalString("0.85"),
            volatility: decimalString("0.35"),
          },
        ],
      },
      provenanceBase,
    );
    if (!result.ok) throw new Error(JSON.stringify(result.error));
    const call = bsmPriceRaw({
      s: 30.3,
      k: 31,
      t: timeToExpiry(),
      r: Number(result.value.riskFreeRate),
      q: 0,
      sigma: 0.35,
      right: "call",
    });
    const expected = centavosOf(
      new Decimal("30.30").sub("29.50").sub(new Decimal(call).sub("0.85")).mul(100),
    );
    expect(pointAt(result.value.payoffNow ?? [], "30.30")?.pnl).toBe(centavos(expected));
  });

  it("scales an index option's model value down by its price factor (ADR-0063)", () => {
    const index: OptionSeries = {
      ticker: "IBOVA183",
      underlying: "PETR4",
      right: "call",
      strike: decimalString("183000"),
      expiry,
      style: "european",
      asOf: at,
      priceFactor: decimalString("100"),
    };
    const result = priceOperation(
      {
        view: viewAt("180000", [index]),
        at,
        legs: [
          {
            role: "call",
            side: "buy",
            ticker: "IBOVA183",
            quantity: quantity(1),
            price: decimalString("30.00"),
            volatility: decimalString("0.20"),
          },
        ],
      },
      provenanceBase,
    );
    if (!result.ok) throw new Error(JSON.stringify(result.error));
    const fair = bsmPriceRaw({
      s: 180000,
      k: 183000,
      t: timeToExpiry(),
      r: Number(result.value.riskFreeRate),
      q: 0,
      sigma: 0.2,
      right: "call",
    });
    const expected = centavosOf(new Decimal(fair).div(100).sub("30.00"));
    expect(pointAt(result.value.payoffNow ?? [], "180000.00")?.pnl).toBe(centavos(expected));
  });
});

const R = 0.105;

function dummyValuation(
  role: "call" | "put" | "stock",
  side: "buy" | "sell",
  qty: number,
): LegValuation {
  return {
    leg: { role, side, ticker: role === "stock" ? "PETR4" : "PETR4X", quantity: quantity(qty) },
    price: null,
    priceSource: null,
    stale: null,
    fairValue: null,
    impliedVolatility: null,
    volatilitySource: null,
    greeks: null,
    timeToExpiryYears: null,
    notes: [],
  };
}

function optionLeg(args: {
  right: "call" | "put";
  side: "buy" | "sell";
  strike: string;
  premium: string;
  qty: number;
  sigma: number;
  t: number;
}): PricedLeg {
  return {
    valuation: dummyValuation(args.right, args.side, args.qty),
    strike: decimalString(args.strike),
    premiumPerUnit: new Decimal(args.premium),
    priceFactor: new Decimal(1),
    model: { sigma: args.sigma, timeToExpiryYears: args.t },
  };
}

function expiryPnl(legs: readonly PricedLeg[], underlying: Decimal): number {
  const reais = legs.reduce((acc, leg) => {
    const strike = new Decimal(leg.strike ?? "0");
    const value =
      leg.valuation.leg.role === "call"
        ? Decimal.max(underlying.sub(strike), 0)
        : Decimal.max(strike.sub(underlying), 0);
    const sign = leg.valuation.leg.side === "buy" ? 1 : -1;
    return acc.add(value.sub(leg.premiumPerUnit).mul(sign).mul(leg.valuation.leg.quantity));
  }, new Decimal(0));
  return centavosOf(reais);
}

function now(
  legs: readonly PricedLeg[],
  spot: string,
  r: number,
  expiryUnderlyings: readonly string[] = [],
): PayoffPoint[] {
  const points = computePayoffNow(
    legs,
    decimalString(spot),
    expiryUnderlyings.map((u) => decimalString(u)),
    decimalString(String(r)),
    decimalString("0"),
  );
  if (points === null) throw new Error("expected a T+0 curve");
  return points;
}

const spotArb = fc.integer({ min: 500, max: 20_000 }).map((c) => new Decimal(c).div(100));
const moneynessArb = fc.double({ min: 0.7, max: 1.3, noNaN: true });
const sigmaArb = fc.double({ min: 0.05, max: 1.2, noNaN: true });
const tArb = fc.double({ min: 1 / 252, max: 1, noNaN: true });
const premiumArb = fc.integer({ min: 0, max: 2_000 }).map((c) => new Decimal(c).div(100));
const qtyArb = fc.integer({ min: 1, max: 1_000 });

function strikeFrom(spot: Decimal, moneyness: number): string {
  return Decimal.max(spot.mul(moneyness), "0.01").toFixed(2);
}

// The engine's normal CDF is Abramowitz & Stegun 7.1.26 (black-scholes.ts), off by up to
// 1.5e-7 per evaluation: two evaluations against a strike or spot under R$ 312 move a unit's
// value by under 0.01 centavo, so one centavo per 100 units bounds the approximation.
function slack(qty: number): number {
  return Math.ceil(qty / 100);
}

describe("computePayoffNow", () => {
  it("is null when any option leg has no model to value it with", () => {
    const leg: PricedLeg = {
      ...optionLeg({
        right: "call",
        side: "buy",
        strike: "40.00",
        premium: "1.00",
        qty: 1,
        sigma: 0.3,
        t: 0.1,
      }),
      model: null,
    };
    expect(
      computePayoffNow([leg], decimalString("40.00"), [], decimalString("0.1"), decimalString("0")),
    ).toBeNull();
  });

  it("converges to the expiry payoff as time to expiry shrinks", () => {
    const legs = [
      optionLeg({
        right: "call",
        side: "buy",
        strike: "40.00",
        premium: "1.20",
        qty: 100,
        sigma: 0.3,
        t: 1e-12,
      }),
      optionLeg({
        right: "put",
        side: "sell",
        strike: "36.00",
        premium: "0.70",
        qty: 100,
        sigma: 0.4,
        t: 1e-12,
      }),
    ];
    for (const point of now(legs, "38.00", R, ["36.00", "40.00"])) {
      const expected = expiryPnl(legs, new Decimal(point.underlying));
      expect(Math.abs(point.pnl - expected)).toBeLessThanOrEqual(1);
    }
  });

  it("values a long call at least at its expiry payoff (r >= 0, q = 0)", () => {
    fc.assert(
      fc.property(
        spotArb,
        moneynessArb,
        sigmaArb,
        tArb,
        premiumArb,
        qtyArb,
        fc.double({ min: 0, max: 0.3, noNaN: true }),
        (spot, moneyness, sigma, t, premium, qty, r) => {
          const legs = [
            optionLeg({
              right: "call",
              side: "buy",
              strike: strikeFrom(spot, moneyness),
              premium: premium.toFixed(2),
              qty,
              sigma,
              t,
            }),
          ];
          for (const point of now(legs, spot.toFixed(2), r)) {
            const atExpiry = expiryPnl(legs, new Decimal(point.underlying));
            expect(point.pnl).toBeGreaterThanOrEqual(atExpiry - slack(qty));
          }
        },
      ),
    );
  });

  // A European put can trade below intrinsic when r > 0 (P >= K e^(-rT) - S, Hull ch. 11), so
  // the time-value floor holds for a put only at r = 0.
  it("values a long put at least at its expiry payoff (r = 0, q = 0)", () => {
    fc.assert(
      fc.property(
        spotArb,
        moneynessArb,
        sigmaArb,
        tArb,
        premiumArb,
        qtyArb,
        (spot, moneyness, sigma, t, premium, qty) => {
          const legs = [
            optionLeg({
              right: "put",
              side: "buy",
              strike: strikeFrom(spot, moneyness),
              premium: premium.toFixed(2),
              qty,
              sigma,
              t,
            }),
          ];
          for (const point of now(legs, spot.toFixed(2), 0)) {
            const atExpiry = expiryPnl(legs, new Decimal(point.underlying));
            expect(point.pnl).toBeGreaterThanOrEqual(atExpiry - slack(qty));
          }
        },
      ),
    );
  });

  it("values a synthetic long (long call, short put, one strike) at S - K e^(-rT) less the net premium", () => {
    fc.assert(
      fc.property(
        spotArb,
        moneynessArb,
        sigmaArb,
        tArb,
        premiumArb,
        premiumArb,
        qtyArb,
        fc.double({ min: 0, max: 0.3, noNaN: true }),
        (spot, moneyness, sigma, t, callPremium, putPremium, qty, r) => {
          const strike = strikeFrom(spot, moneyness);
          const legs = [
            optionLeg({
              right: "call",
              side: "buy",
              strike,
              premium: callPremium.toFixed(2),
              qty,
              sigma,
              t,
            }),
            optionLeg({
              right: "put",
              side: "sell",
              strike,
              premium: putPremium.toFixed(2),
              qty,
              sigma,
              t,
            }),
          ];
          for (const point of now(legs, spot.toFixed(2), r)) {
            const forward = new Decimal(point.underlying)
              .sub(new Decimal(strike).mul(Math.exp(-r * t)))
              .sub(callPremium)
              .add(putPremium)
              .mul(qty);
            expect(Math.abs(point.pnl - centavosOf(forward))).toBeLessThanOrEqual(slack(qty) + 1);
          }
        },
      ),
    );
  });

  it("rises with the underlying for a long call", () => {
    fc.assert(
      fc.property(
        spotArb,
        moneynessArb,
        sigmaArb,
        tArb,
        premiumArb,
        qtyArb,
        fc.double({ min: 0, max: 0.3, noNaN: true }),
        (spot, moneyness, sigma, t, premium, qty, r) => {
          const strike = strikeFrom(spot, moneyness);
          const legs = [
            optionLeg({
              right: "call",
              side: "buy",
              strike,
              premium: premium.toFixed(2),
              qty,
              sigma,
              t,
            }),
          ];
          const points = now(legs, spot.toFixed(2), r, [strike]);
          for (let i = 1; i < points.length; i += 1) {
            expect(points[i]?.pnl ?? 0).toBeGreaterThanOrEqual(points[i - 1]?.pnl ?? 0);
          }
        },
      ),
    );
  });

  // Hull, Options, Futures, and Other Derivatives, Example 15.6: S = 42, K = 40, r = 10%,
  // sigma = 20%, T = 0.5 gives c = 4.76 and p = 0.81. Zero premium makes the T+0 P&L the value.
  it("values Hull's Example 15.6 call and put at 4.76 and 0.81 at spot", () => {
    const hull = { strike: "40.00", premium: "0", qty: 1, sigma: 0.2, t: 0.5 };
    const call = pointAt(
      now([optionLeg({ ...hull, right: "call", side: "buy" })], "42.00", 0.1),
      "42.00",
    );
    const put = pointAt(
      now([optionLeg({ ...hull, right: "put", side: "buy" })], "42.00", 0.1),
      "42.00",
    );
    expect(Math.abs((call?.pnl ?? Number.NaN) - 476)).toBeLessThanOrEqual(1);
    expect(Math.abs((put?.pnl ?? Number.NaN) - 81)).toBeLessThanOrEqual(1);
  });

  it("draws the model, not a chord, between a far strike and the 0.8x spot sample", () => {
    const t = 0.25;
    const sigma = 0.35;
    const leg = optionLeg({
      right: "put",
      side: "buy",
      strike: "65.00",
      premium: "0.10",
      qty: 1,
      sigma,
      t,
    });
    const curve = now([leg], "100.00", R, ["64.90", "65.00", "80.00", "100.00", "120.00"]);
    const below = curve.filter((p) => new Decimal(p.underlying).lte("72.50")).at(-1);
    const above = curve.find((p) => new Decimal(p.underlying).gt("72.50"));
    if (!below || !above) throw new Error("72.50 lies inside the sampled range");
    const weight = new Decimal("72.50")
      .sub(below.underlying)
      .div(new Decimal(above.underlying).sub(below.underlying));
    const drawn = new Decimal(below.pnl).add(weight.mul(above.pnl - below.pnl));
    const model = new Decimal(
      bsmPriceRaw({ s: 72.5, k: 65, t, r: R, q: 0, sigma, right: "put" }),
    ).sub("0.10");
    expect(drawn.sub(model.mul(100)).abs().toNumber()).toBeLessThanOrEqual(1);
    for (let percent = 65; percent <= 120; percent += 1) {
      expect(pointAt(curve, `${String(percent)}.00`)).toBeDefined();
    }
  });

  it("widens the step outside 0.8x-1.2x of spot so a far break-even cannot explode the sample count", () => {
    const leg = optionLeg({
      right: "call",
      side: "buy",
      strike: "100.00",
      premium: "1.00",
      qty: 1,
      sigma: 0.3,
      t: 0.1,
    });
    const expiryUnderlyings = ["1.00", "80.00", "100.00", "120.00", "1000.00"];
    const curve = now([leg], "100.00", R, expiryUnderlyings);
    expect(curve.length).toBeLessThanOrEqual(120 + expiryUnderlyings.length);
    for (let percent = 80; percent <= 120; percent += 1) {
      expect(pointAt(curve, `${String(percent)}.00`)).toBeDefined();
    }
    expect(curve[0]?.underlying).toBe("1.00");
    expect(curve.at(-1)?.underlying).toBe("1000.00");
    const gaps = curve
      .slice(1)
      .map((p, i) => new Decimal(p.underlying).sub(curve[i]?.underlying ?? "0"));
    expect(Decimal.max(...gaps).toNumber()).toBeLessThan(20);
  });

  it("values a short call as the exact negation of the long call", () => {
    const long = optionLeg({
      right: "call",
      side: "buy",
      strike: "40.00",
      premium: "1.20",
      qty: 100,
      sigma: 0.3,
      t: 0.1,
    });
    const short: PricedLeg = { ...long, valuation: dummyValuation("call", "sell", 100) };
    const longCurve = now([long], "40.00", R);
    const shortCurve = now([short], "40.00", R);
    expect(shortCurve.map((p) => p.pnl + 0)).toEqual(longCurve.map((p) => 0 - p.pnl));
  });
});
