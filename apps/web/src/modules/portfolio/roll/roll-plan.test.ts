import { describe, expect, it } from "vitest";
import {
  decimalStringSchema,
  quantitySchema,
  sessionDateSchema,
  tickerSchema,
} from "@fetha/contracts";
import type { OptionSeries } from "@fetha/engine";

import { planRoll, type HeldLegFacts } from "./roll-plan";

function series(partial: Partial<OptionSeries>): OptionSeries {
  return {
    ticker: tickerSchema.parse("PETR4F300"),
    underlying: tickerSchema.parse("PETR4"),
    right: "call",
    strike: decimalStringSchema.parse("30.000000"),
    expiry: sessionDateSchema.parse("2026-12-18"),
    style: "european",
    asOf: "2026-11-19T18:00:00.000Z",
    ...partial,
  };
}

const currentExpiry = sessionDateSchema.parse("2026-11-20");
const nextExpiry = sessionDateSchema.parse("2026-12-18");
const underlying = tickerSchema.parse("PETR4");

describe("planRoll", () => {
  it("rolls a short call leg to the nearest strike at the next monthly expiry, side reversed to close", () => {
    const legs: HeldLegFacts[] = [
      {
        leg: {
          role: "call",
          side: "sell",
          ticker: tickerSchema.parse("PETR4F300"),
          quantity: quantitySchema.parse(100),
        },
        right: "call",
        strike: decimalStringSchema.parse("30.000000"),
      },
    ];
    const monthlySeries = [
      series({ ticker: tickerSchema.parse("PETR4F300"), expiry: currentExpiry }),
      series({ ticker: tickerSchema.parse("PETR4G300"), expiry: nextExpiry }),
    ];
    const tradedSeries = monthlySeries;

    const result = planRoll(underlying, currentExpiry, legs, monthlySeries, tradedSeries);
    if (!result.ok) throw new Error("expected the roll to plan");
    expect(result.expiry).toBe(nextExpiry);
    const [leg] = result.legs;
    expect(leg?.closingLeg).toEqual({
      role: "call",
      side: "buy",
      ticker: "PETR4F300",
      quantity: 100,
    });
    expect(leg?.openingLeg).toEqual({
      role: "call",
      side: "sell",
      ticker: "PETR4G300",
      quantity: 100,
    });
    expect(leg?.targetSeries.ticker).toBe("PETR4G300");
  });

  it("keeps a long put leg's side on the opening order and reverses it only to close", () => {
    const legs: HeldLegFacts[] = [
      {
        leg: {
          role: "put",
          side: "buy",
          ticker: tickerSchema.parse("PETR4F300"),
          quantity: quantitySchema.parse(200),
        },
        right: "put",
        strike: decimalStringSchema.parse("30.000000"),
      },
    ];
    const monthlySeries = [
      series({ ticker: tickerSchema.parse("PETR4F300"), right: "put", expiry: currentExpiry }),
      series({ ticker: tickerSchema.parse("PETR4G300"), right: "put", expiry: nextExpiry }),
    ];
    const tradedSeries = monthlySeries;

    const result = planRoll(underlying, currentExpiry, legs, monthlySeries, tradedSeries);
    if (!result.ok) throw new Error("expected the roll to plan");
    const [leg] = result.legs;
    expect(leg?.closingLeg).toEqual({
      role: "put",
      side: "sell",
      ticker: "PETR4F300",
      quantity: 200,
    });
    expect(leg?.openingLeg).toEqual({
      role: "put",
      side: "buy",
      ticker: "PETR4G300",
      quantity: 200,
    });
  });

  it("refuses the whole roll when the next monthly expiry cannot be found", () => {
    const legs: HeldLegFacts[] = [
      {
        leg: {
          role: "call",
          side: "sell",
          ticker: tickerSchema.parse("PETR4F300"),
          quantity: quantitySchema.parse(100),
        },
        right: "call",
        strike: decimalStringSchema.parse("30.000000"),
      },
    ];
    const monthlySeries = [
      series({ ticker: tickerSchema.parse("PETR4F300"), expiry: currentExpiry }),
    ];

    const result = planRoll(underlying, currentExpiry, legs, monthlySeries, monthlySeries);
    expect(result).toEqual({ ok: false, reason: "no_next_expiry" });
  });

  it("picks the next expiry from the full monthly chain even when it has no traded series yet, so no_traded_series is reachable", () => {
    const legs: HeldLegFacts[] = [
      {
        leg: {
          role: "call",
          side: "sell",
          ticker: tickerSchema.parse("PETR4F300"),
          quantity: quantitySchema.parse(100),
        },
        right: "call",
        strike: decimalStringSchema.parse("30.000000"),
      },
    ];
    const monthlySeries = [
      series({ ticker: tickerSchema.parse("PETR4F300"), expiry: currentExpiry }),
      series({ ticker: tickerSchema.parse("PETR4G300"), expiry: nextExpiry }),
    ];
    const tradedSeries = [
      series({ ticker: tickerSchema.parse("PETR4F300"), expiry: currentExpiry }),
    ];

    const result = planRoll(underlying, currentExpiry, legs, monthlySeries, tradedSeries);
    expect(result).toEqual({ ok: false, reason: "no_traded_series", ticker: "PETR4F300" });
  });

  it("keeps every leg on the one shared next expiry, never splitting a strangle across two", () => {
    const legs: HeldLegFacts[] = [
      {
        leg: {
          role: "call",
          side: "sell",
          ticker: tickerSchema.parse("PETR4F320"),
          quantity: quantitySchema.parse(100),
        },
        right: "call",
        strike: decimalStringSchema.parse("32.000000"),
      },
      {
        leg: {
          role: "put",
          side: "sell",
          ticker: tickerSchema.parse("PETR4F280"),
          quantity: quantitySchema.parse(100),
        },
        right: "put",
        strike: decimalStringSchema.parse("28.000000"),
      },
    ];
    const monthlySeries = [
      series({ ticker: tickerSchema.parse("PETR4F320"), expiry: currentExpiry }),
      series({ ticker: tickerSchema.parse("PETR4F280"), right: "put", expiry: currentExpiry }),
      series({
        ticker: tickerSchema.parse("PETR4G320"),
        strike: decimalStringSchema.parse("32.000000"),
        expiry: nextExpiry,
      }),
      series({
        ticker: tickerSchema.parse("PETR4G280"),
        right: "put",
        strike: decimalStringSchema.parse("28.000000"),
        expiry: nextExpiry,
      }),
      series({
        ticker: tickerSchema.parse("PETR4H320"),
        strike: decimalStringSchema.parse("32.000000"),
        expiry: sessionDateSchema.parse("2027-01-15"),
      }),
    ];
    const tradedSeries = monthlySeries;

    const result = planRoll(underlying, currentExpiry, legs, monthlySeries, tradedSeries);
    if (!result.ok) throw new Error("expected the roll to plan");
    expect(result.legs.map((leg) => leg.targetSeries.expiry)).toEqual([nextExpiry, nextExpiry]);
  });

  it("refuses when two legs would resolve to the same ticker", () => {
    const legs: HeldLegFacts[] = [
      {
        leg: {
          role: "call",
          side: "sell",
          ticker: tickerSchema.parse("PETR4F310"),
          quantity: quantitySchema.parse(100),
        },
        right: "call",
        strike: decimalStringSchema.parse("31.000000"),
      },
      {
        leg: {
          role: "put",
          side: "sell",
          ticker: tickerSchema.parse("PETR4F290"),
          quantity: quantitySchema.parse(100),
        },
        right: "put",
        strike: decimalStringSchema.parse("29.000000"),
      },
    ];
    const monthlySeries = [
      series({ ticker: tickerSchema.parse("PETR4F310"), expiry: currentExpiry }),
      series({ ticker: tickerSchema.parse("PETR4F290"), right: "put", expiry: currentExpiry }),
      series({
        ticker: tickerSchema.parse("PETR4G300"),
        strike: decimalStringSchema.parse("30.000000"),
        expiry: nextExpiry,
      }),
      series({
        ticker: tickerSchema.parse("PETR4G300"),
        right: "put",
        strike: decimalStringSchema.parse("30.000000"),
        expiry: nextExpiry,
      }),
    ];
    const tradedSeries = monthlySeries;

    const result = planRoll(underlying, currentExpiry, legs, monthlySeries, tradedSeries);
    expect(result).toEqual({ ok: false, reason: "duplicate_ticker", ticker: "PETR4G300" });
  });

  it("refuses when the strike width between legs would change", () => {
    const legs: HeldLegFacts[] = [
      {
        leg: {
          role: "call",
          side: "sell",
          ticker: tickerSchema.parse("PETR4F320"),
          quantity: quantitySchema.parse(100),
        },
        right: "call",
        strike: decimalStringSchema.parse("32.000000"),
      },
      {
        leg: {
          role: "put",
          side: "sell",
          ticker: tickerSchema.parse("PETR4F280"),
          quantity: quantitySchema.parse(100),
        },
        right: "put",
        strike: decimalStringSchema.parse("28.000000"),
      },
    ];
    const monthlySeries = [
      series({ ticker: tickerSchema.parse("PETR4F320"), expiry: currentExpiry }),
      series({ ticker: tickerSchema.parse("PETR4F280"), right: "put", expiry: currentExpiry }),
      series({
        ticker: tickerSchema.parse("PETR4G320"),
        strike: decimalStringSchema.parse("32.000000"),
        expiry: nextExpiry,
      }),
      series({
        ticker: tickerSchema.parse("PETR4G290"),
        right: "put",
        strike: decimalStringSchema.parse("29.000000"),
        expiry: nextExpiry,
      }),
    ];
    const tradedSeries = monthlySeries;

    const result = planRoll(underlying, currentExpiry, legs, monthlySeries, tradedSeries);
    expect(result).toEqual({ ok: false, reason: "strike_width_changed" });
  });

  it("reports the failing leg's own ticker when no traded series matches it at the shared expiry", () => {
    const legs: HeldLegFacts[] = [
      {
        leg: {
          role: "call",
          side: "sell",
          ticker: tickerSchema.parse("PETR4F300"),
          quantity: quantitySchema.parse(100),
        },
        right: "call",
        strike: decimalStringSchema.parse("30.000000"),
      },
      {
        leg: {
          role: "put",
          side: "buy",
          ticker: tickerSchema.parse("PETR4F200"),
          quantity: quantitySchema.parse(100),
        },
        right: "put",
        strike: decimalStringSchema.parse("20.000000"),
      },
    ];
    const monthlySeries = [
      series({ ticker: tickerSchema.parse("PETR4F300"), expiry: currentExpiry }),
      series({ ticker: tickerSchema.parse("PETR4F200"), right: "put", expiry: currentExpiry }),
      series({
        ticker: tickerSchema.parse("PETR4G300"),
        strike: decimalStringSchema.parse("30.000000"),
        expiry: nextExpiry,
      }),
    ];
    const tradedSeries = monthlySeries;

    const result = planRoll(underlying, currentExpiry, legs, monthlySeries, tradedSeries);
    expect(result).toEqual({ ok: false, reason: "no_traded_series", ticker: "PETR4F200" });
  });

  it("is a pure function: the same inputs always produce the same output", () => {
    const legs: HeldLegFacts[] = [
      {
        leg: {
          role: "call",
          side: "sell",
          ticker: tickerSchema.parse("PETR4F300"),
          quantity: quantitySchema.parse(100),
        },
        right: "call",
        strike: decimalStringSchema.parse("30.000000"),
      },
    ];
    const monthlySeries = [
      series({ ticker: tickerSchema.parse("PETR4F300"), expiry: currentExpiry }),
      series({ ticker: tickerSchema.parse("PETR4G300"), expiry: nextExpiry }),
    ];
    const tradedSeries = monthlySeries;
    expect(planRoll(underlying, currentExpiry, legs, monthlySeries, tradedSeries)).toEqual(
      planRoll(underlying, currentExpiry, legs, monthlySeries, tradedSeries),
    );
  });
});
