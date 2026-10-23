import Decimal from "decimal.js";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { decimalStringSchema, tickerSchema } from "@fetha/contracts";

import { detectCashDistributions, type StrikeTransition } from "./cash-distribution-detection";

function transition(underlying: string, previous: string, strike: string): StrikeTransition {
  return {
    underlying: tickerSchema.parse(underlying),
    previousStrike: decimalStringSchema.parse(previous),
    strike: decimalStringSchema.parse(strike),
  };
}

function shifted(underlying: string, strikes: readonly string[], drop: string): StrikeTransition[] {
  return strikes.map((strike) =>
    transition(underlying, strike, new Decimal(strike).minus(drop).toFixed(8)),
  );
}

describe("detectCashDistributions", () => {
  // COTAHIST 2024-03-11 -> 2024-03-12: every VALE3 series lowered by R$ 2,74.
  it("reads a uniform strike drop as a distribution of that amount", () => {
    const detected = detectCashDistributions(
      shifted("VALE3", ["60.00000000", "62.50000000", "64.92000000", "70.00000000"], "2.74"),
    );
    expect(detected).toEqual([{ underlying: "VALE3", amount: "2.74", seriesCount: 4 }]);
  });

  // COTAHIST 2024-04-15 -> 2024-04-16: BBAS3's 2-for-1 split halves every strike.
  it("ignores a proportional drop, which a split or a bonus makes", () => {
    const detected = detectCashDistributions([
      transition("BBAS3", "50.00000000", "25.00000000"),
      transition("BBAS3", "55.00000000", "27.50000000"),
      transition("BBAS3", "60.00000000", "30.00000000"),
    ]);
    expect(detected).toEqual([]);
  });

  it("needs two distinct previous strikes to tell a distribution from a factor", () => {
    expect(
      detectCashDistributions([
        transition("ABEV3", "12.00000000", "11.37000000"),
        transition("ABEV3", "12.00000000", "11.37000000"),
      ]),
    ).toEqual([]);
  });

  it("tolerates up to one series in ten disagreeing", () => {
    const strikes = Array.from({ length: 9 }, (_, index) => `${String(30 + index)}.00000000`);
    const detected = detectCashDistributions([
      ...shifted("PETR4", strikes, "1.55"),
      transition("PETR4", "45.00000000", "44.97000000"),
    ]);
    expect(detected).toEqual([{ underlying: "PETR4", amount: "1.55", seriesCount: 9 }]);
  });

  it("drops an underlying whose series disagree more than that", () => {
    const detected = detectCashDistributions([
      ...shifted("ROMI3", ["10.00000000", "11.00000000", "12.00000000"], "0.61"),
      transition("ROMI3", "13.00000000", "12.41000000"),
    ]);
    expect(detected).toEqual([]);
  });

  it("ignores strikes that rise, which a reverse split makes", () => {
    expect(
      detectCashDistributions(
        shifted("MGLU3", ["1.00000000", "1.50000000", "2.00000000"], "-0.50"),
      ),
    ).toEqual([]);
  });

  // BBDC3 and BBDC4 options share the BBDC root but pay different amounts: the registry's
  // underlying keeps them apart.
  it("detects each underlying on its own", () => {
    const detected = detectCashDistributions([
      ...shifted("BBDC4", ["13.00000000", "14.00000000"], "0.02"),
      ...shifted("BBDC3", ["12.00000000", "13.00000000"], "0.01"),
    ]);
    expect(detected).toEqual([
      { underlying: "BBDC3", amount: "0.01", seriesCount: 2 },
      { underlying: "BBDC4", amount: "0.02", seriesCount: 2 },
    ]);
  });

  it("skips an underlying with a recorded factor on the same session", () => {
    const detected = detectCashDistributions(
      shifted("ITUB4", ["30.00000000", "32.00000000"], "0.02"),
      new Set(["ITUB4"]),
    );
    expect(detected).toEqual([]);
  });

  it("finds the amount of any uniform positive drop across distinct strikes", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 100_000 }),
        fc.uniqueArray(fc.integer({ min: 100_001, max: 10_000_000 }), {
          minLength: 2,
          maxLength: 40,
        }),
        (dropCents, strikeCents) => {
          const drop = new Decimal(dropCents).div(100);
          const detected = detectCashDistributions(
            strikeCents.map((cents) =>
              transition(
                "WEGE3",
                new Decimal(cents).div(100).toFixed(8),
                new Decimal(cents).div(100).minus(drop).toFixed(8),
              ),
            ),
          );
          expect(detected).toHaveLength(1);
          expect(new Decimal(detected[0]?.amount ?? "0").equals(drop)).toBe(true);
        },
      ),
    );
  });
});
