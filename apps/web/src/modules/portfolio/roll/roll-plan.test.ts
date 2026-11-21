import { describe, expect, it } from "vitest";
import {
  decimalStringSchema,
  quantitySchema,
  sessionDateSchema,
  tickerSchema,
} from "@fetha/contracts";
import type { OptionSeries } from "@fetha/engine";

import { planRollLegs, type HeldLegFacts } from "./roll-plan";

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
const underlying = tickerSchema.parse("PETR4");

describe("planRollLegs", () => {
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
    const optionSeries = [
      series({ ticker: tickerSchema.parse("PETR4F300"), expiry: currentExpiry }),
      series({
        ticker: tickerSchema.parse("PETR4G300"),
        strike: decimalStringSchema.parse("30.000000"),
        expiry: sessionDateSchema.parse("2026-12-18"),
      }),
    ];

    const [result] = planRollLegs(underlying, currentExpiry, legs, optionSeries);
    if (!result?.ok) throw new Error("expected the leg to roll");
    expect(result.closingLeg).toEqual({
      role: "call",
      side: "buy",
      ticker: "PETR4F300",
      quantity: 100,
    });
    expect(result.openingLeg).toEqual({
      role: "call",
      side: "sell",
      ticker: "PETR4G300",
      quantity: 100,
    });
    expect(result.targetSeries.ticker).toBe("PETR4G300");
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
    const optionSeries = [
      series({ ticker: tickerSchema.parse("PETR4F300"), right: "put", expiry: currentExpiry }),
      series({
        ticker: tickerSchema.parse("PETR4G300"),
        right: "put",
        strike: decimalStringSchema.parse("30.000000"),
        expiry: sessionDateSchema.parse("2026-12-18"),
      }),
    ];

    const [result] = planRollLegs(underlying, currentExpiry, legs, optionSeries);
    if (!result?.ok) throw new Error("expected the leg to roll");
    expect(result.closingLeg).toEqual({
      role: "put",
      side: "sell",
      ticker: "PETR4F300",
      quantity: 200,
    });
    expect(result.openingLeg).toEqual({
      role: "put",
      side: "buy",
      ticker: "PETR4G300",
      quantity: 200,
    });
    expect(result.targetSeries.ticker).toBe("PETR4G300");
  });

  it("reports a per-leg failure with its own ticker when no series selects, leaving other legs independent", () => {
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
    const optionSeries = [
      series({ ticker: tickerSchema.parse("PETR4F300"), expiry: currentExpiry }),
      series({
        ticker: tickerSchema.parse("PETR4G300"),
        strike: decimalStringSchema.parse("30.000000"),
        expiry: sessionDateSchema.parse("2026-12-18"),
      }),
      series({ ticker: tickerSchema.parse("PETR4F200"), right: "put", expiry: currentExpiry }),
    ];

    const results = planRollLegs(underlying, currentExpiry, legs, optionSeries);
    expect(results[0]).toEqual(expect.objectContaining({ ok: true }));
    expect(results[1]).toEqual({
      ok: false,
      ticker: "PETR4F200",
      reason: "no_next_expiry",
    });
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
    const optionSeries = [
      series({ ticker: tickerSchema.parse("PETR4F300"), expiry: currentExpiry }),
      series({
        ticker: tickerSchema.parse("PETR4G300"),
        strike: decimalStringSchema.parse("30.000000"),
        expiry: sessionDateSchema.parse("2026-12-18"),
      }),
    ];
    expect(planRollLegs(underlying, currentExpiry, legs, optionSeries)).toEqual(
      planRollLegs(underlying, currentExpiry, legs, optionSeries),
    );
  });
});
