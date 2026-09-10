import { describe, expect, it } from "vitest";
import type { DecimalString } from "./scalars";
import type { StrategyDefinition } from "./strategy-definition";
import type { Structure } from "./structure";
import { checkStrategyCoherence } from "./strategy-coherence";

function decimal(value: string): DecimalString {
  return value as DecimalString;
}

const stockStructure: Structure = {
  id: "stock",
  name: "Compra de ação",
  expiry: "shared",
  legs: [{ role: "stock", side: "buy", ratio: 1 }],
};

const collarStructure: Structure = {
  id: "collar",
  name: "Collar",
  expiry: "shared",
  legs: [
    { role: "stock", side: "buy", ratio: 1 },
    { role: "call", side: "sell", ratio: 1, strikeRank: 1 },
    { role: "put", side: "buy", ratio: 1, strikeRank: 2 },
  ],
};

function baseDefinition(overrides: Partial<StrategyDefinition> = {}): StrategyDefinition {
  return {
    name: "Estratégia",
    timeframe: "D1",
    entry: {
      kind: "compare",
      left: { kind: "indicator", indicator: { kind: "sma", length: 20 } },
      comparator: ">",
      right: { kind: "price", field: "close" },
    },
    structureId: "stock",
    strikes: [],
    sizing: { kind: "fixed_fractional", fraction: decimal("0.1") },
    exit: [],
    adjustments: [],
    ...overrides,
  };
}

describe("checkStrategyCoherence", () => {
  it("accepts a stock-only definition with no strikes, no expiry, no adjustments", () => {
    expect(checkStrategyCoherence(baseDefinition(), stockStructure)).toEqual({ ok: true });
  });

  it("rejects a mismatched structureId", () => {
    const result = checkStrategyCoherence(
      baseDefinition({ structureId: "collar" }),
      stockStructure,
    );
    expect(result).toEqual({
      ok: false,
      path: "structureId",
      message: "definition.structureId must match structure.id",
    });
  });

  it("rejects strikes on a stock-only structure", () => {
    const result = checkStrategyCoherence(
      baseDefinition({
        strikes: [{ kind: "delta", target: decimal("0.3") }],
        expiry: { kind: "business_days", min: 5, max: 20 },
      }),
      stockStructure,
    );
    expect(result).toEqual({
      ok: false,
      path: "strikes",
      message: "a stock-only structure cannot select strikes",
    });
  });

  it("rejects an expiry selection on a stock-only structure", () => {
    const result = checkStrategyCoherence(
      baseDefinition({ expiry: { kind: "business_days", min: 5, max: 20 } }),
      stockStructure,
    );
    expect(result).toEqual({
      ok: false,
      path: "expiry",
      message: "a stock-only structure has no expiry to select",
    });
  });

  it("rejects a days_before_expiry exit rule on a stock-only structure", () => {
    const result = checkStrategyCoherence(
      baseDefinition({ exit: [{ kind: "days_before_expiry", businessDays: 3 }] }),
      stockStructure,
    );
    expect(result).toEqual({
      ok: false,
      path: "exit",
      message: "days_before_expiry is meaningless for a stock-only structure",
    });
  });

  it("rejects adjustments on a stock-only structure", () => {
    const result = checkStrategyCoherence(
      baseDefinition({
        adjustments: [
          {
            kind: "roll",
            when: { kind: "days_before_expiry", businessDays: 3 },
            expiry: { kind: "business_days", min: 5, max: 20 },
            strikes: [{ kind: "delta", target: decimal("0.3") }],
          },
        ],
      }),
      stockStructure,
    );
    expect(result).toEqual({
      ok: false,
      path: "adjustments",
      message: "roll is meaningless for a stock-only structure",
    });
  });

  it("requires an expiry selection when the structure has option legs", () => {
    const result = checkStrategyCoherence(
      baseDefinition({
        structureId: "collar",
        strikes: [
          { kind: "delta", target: decimal("0.3") },
          { kind: "delta", target: decimal("0.3") },
        ],
      }),
      collarStructure,
    );
    expect(result).toEqual({
      ok: false,
      path: "expiry",
      message: "a structure with option legs requires an expiry selection",
    });
  });

  it("requires strikes.length to equal the number of distinct strike ranks", () => {
    const result = checkStrategyCoherence(
      baseDefinition({
        structureId: "collar",
        strikes: [{ kind: "delta", target: decimal("0.3") }],
        expiry: { kind: "business_days", min: 5, max: 20 },
      }),
      collarStructure,
    );
    expect(result).toEqual({
      ok: false,
      path: "strikes",
      message: "strikes.length must equal the number of distinct strike ranks",
    });
  });

  it("accepts a coherent option definition", () => {
    const result = checkStrategyCoherence(
      baseDefinition({
        structureId: "collar",
        strikes: [
          { kind: "delta", target: decimal("0.3") },
          { kind: "delta", target: decimal("0.3") },
        ],
        expiry: { kind: "business_days", min: 5, max: 20 },
      }),
      collarStructure,
    );
    expect(result).toEqual({ ok: true });
  });
});
