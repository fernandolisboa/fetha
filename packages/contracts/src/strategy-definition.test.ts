import { describe, expect, it } from "vitest";
import { strategyDefinitionInputSchema, strategyDefinitionSchema } from "./strategy-definition";

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

describe("strategyDefinitionInputSchema", () => {
  function withEntryIndicator(indicator: unknown) {
    return {
      ...stockOnly,
      entry: {
        kind: "not",
        condition: {
          kind: "compare",
          left: { kind: "price", field: "close" },
          comparator: ">",
          right: { kind: "indicator", indicator },
        },
      },
    };
  }

  function withExitIndicator(indicator: unknown) {
    return {
      ...stockOnly,
      exit: [
        {
          kind: "condition",
          condition: {
            kind: "or",
            conditions: [
              {
                kind: "compare",
                left: { kind: "indicator", indicator },
                comparator: "<",
                right: { kind: "constant", value: "30" },
              },
            ],
          },
        },
      ],
    };
  }

  it("accepts indicator parameters at their bounds", () => {
    expect(
      strategyDefinitionInputSchema.safeParse(withEntryIndicator({ kind: "ema", length: 500 }))
        .success,
    ).toBe(true);
    expect(
      strategyDefinitionInputSchema.safeParse(
        withExitIndicator({ kind: "iv_rank", lookbackSessions: 1260 }),
      ).success,
    ).toBe(true);
  });

  it.each(["sma", "ema", "rsi", "atr"] as const)(
    "rejects a %s length above 500 in the entry or an exit condition",
    (kind) => {
      expect(
        strategyDefinitionInputSchema.safeParse(withEntryIndicator({ kind, length: 501 })).success,
      ).toBe(false);
      expect(
        strategyDefinitionInputSchema.safeParse(withExitIndicator({ kind, length: 501 })).success,
      ).toBe(false);
    },
  );

  it("rejects an indicator above its bound in a roll adjustment's trigger", () => {
    const overBound = {
      ...strategy,
      adjustments: [
        {
          ...roll,
          when: {
            kind: "condition",
            condition: {
              kind: "compare",
              left: { kind: "indicator", indicator: { kind: "rsi", length: 501 } },
              comparator: "<",
              right: { kind: "constant", value: "30" },
            },
          },
        },
      ],
    };
    expect(strategyDefinitionSchema.safeParse(overBound).success).toBe(true);
    expect(strategyDefinitionInputSchema.safeParse(overBound).success).toBe(false);
  });

  it("rejects an iv_rank lookback above 1260 sessions", () => {
    expect(
      strategyDefinitionInputSchema.safeParse(
        withEntryIndicator({ kind: "iv_rank", lookbackSessions: 1261 }),
      ).success,
    ).toBe(false);
  });

  it("keeps the stored-definition schema readable above the bounds", () => {
    const stored = withExitIndicator({ kind: "rsi", length: 100_000 });
    expect(strategyDefinitionSchema.safeParse(stored).success).toBe(true);
    expect(strategyDefinitionInputSchema.safeParse(stored).success).toBe(false);
  });

  it("still enforces the stored-definition rules", () => {
    expect(
      strategyDefinitionInputSchema.safeParse({ ...strategy, expiry: undefined }).success,
    ).toBe(false);
  });
});
