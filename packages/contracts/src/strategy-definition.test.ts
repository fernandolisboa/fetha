import { describe, expect, it } from "vitest";
import { strategyDefinitionSchema } from "./strategy-definition";

const strategy = {
  name: "Trava de alta on pullback",
  timeframe: "D1",
  entry: {
    kind: "and",
    conditions: [
      {
        kind: "compare",
        left: { kind: "price", field: "close" },
        comparator: ">",
        right: { kind: "indicator", indicator: { kind: "sma", length: 50 } },
      },
      {
        kind: "compare",
        left: { kind: "indicator", indicator: { kind: "rsi", length: 14 } },
        comparator: "<",
        right: { kind: "constant", value: "40" },
      },
    ],
  },
  structureId: "bull-call-spread",
  strikes: [
    { kind: "moneyness", percent: "0" },
    { kind: "moneyness", percent: "0.05" },
  ],
  expiry: { kind: "business_days", min: 20, max: 45 },
  sizing: { kind: "fixed_risk", fraction: "0.01" },
  exit: [
    { kind: "profit_target", fractionOfPremium: "0.5" },
    { kind: "days_before_expiry", businessDays: 3 },
  ],
  adjustments: [],
};

const stockOnly = {
  name: "Trend following on stock",
  timeframe: "D1",
  entry: strategy.entry,
  structureId: "stock",
  strikes: [],
  sizing: { kind: "fixed_fractional", fraction: "0.10" },
  exit: [
    {
      kind: "condition",
      condition: {
        kind: "compare",
        left: { kind: "price", field: "close" },
        comparator: "<",
        right: { kind: "indicator", indicator: { kind: "sma", length: 50 } },
      },
    },
  ],
  adjustments: [],
};

const roll = {
  kind: "roll",
  when: { kind: "days_before_expiry", businessDays: 5 },
  expiry: { kind: "business_days", min: 20, max: 45 },
  strikes: [{ kind: "delta", target: "0.30" }],
};

describe("strategyDefinitionSchema", () => {
  it("accepts a complete daily options strategy", () => {
    expect(strategyDefinitionSchema.parse(strategy)).toEqual(strategy);
  });

  it("accepts a stock-only strategy without strikes, expiry, expiry-based exits or rolls", () => {
    expect(strategyDefinitionSchema.parse(stockOnly)).toEqual(stockOnly);
  });

  it("cannot reject expiry-based exits or rolls on a stock-only strategy: the engine does, as invalid_input against the structure (ADR-0013)", () => {
    expect(
      strategyDefinitionSchema.safeParse({
        ...stockOnly,
        exit: [{ kind: "days_before_expiry", businessDays: 3 }],
      }).success,
    ).toBe(true);
    expect(strategyDefinitionSchema.safeParse({ ...stockOnly, adjustments: [roll] }).success).toBe(
      true,
    );
  });

  it("accepts every timeframe and a roll adjustment", () => {
    for (const timeframe of ["15m", "30m", "60m", "D1"]) {
      expect(strategyDefinitionSchema.safeParse({ ...strategy, timeframe }).success).toBe(true);
    }
    expect(strategyDefinitionSchema.safeParse({ ...strategy, adjustments: [roll] }).success).toBe(
      true,
    );
  });

  it("rejects strikes without an expiry", () => {
    const withoutExpiry = Object.fromEntries(
      Object.entries(strategy).filter(([key]) => key !== "expiry"),
    );
    expect(strategyDefinitionSchema.safeParse(withoutExpiry).success).toBe(false);
  });

  it("rejects a strategy without an entry condition or a structure", () => {
    const withoutEntry = Object.fromEntries(
      Object.entries(strategy).filter(([key]) => key !== "entry"),
    );
    expect(strategyDefinitionSchema.safeParse(withoutEntry).success).toBe(false);
    expect(strategyDefinitionSchema.safeParse({ ...strategy, structureId: "" }).success).toBe(
      false,
    );
  });

  it("rejects code, unknown keys and unknown timeframes", () => {
    expect(
      strategyDefinitionSchema.safeParse({ ...strategy, entry: "close > sma(50)" }).success,
    ).toBe(false);
    expect(
      strategyDefinitionSchema.safeParse({ ...strategy, onEntry: "function() {}" }).success,
    ).toBe(false);
    expect(strategyDefinitionSchema.safeParse({ ...strategy, timeframe: "5m" }).success).toBe(
      false,
    );
  });
});
