import { describe, expect, it } from "vitest";
import {
  comparators,
  conditionKinds,
  conditionSchema,
  operandSchema,
  priceFields,
  type Condition,
} from "./condition";

const closeAboveSma20: Condition = {
  kind: "compare",
  left: { kind: "price", field: "close" },
  comparator: ">",
  right: { kind: "indicator", indicator: { kind: "sma", length: 20 } },
};

const rsiOversold: Condition = {
  kind: "compare",
  left: { kind: "indicator", indicator: { kind: "rsi", length: 14 } },
  comparator: "<",
  right: { kind: "constant", value: "30" },
};

describe("operandSchema", () => {
  it("accepts indicator, price and constant operands", () => {
    expect(
      operandSchema.safeParse({ kind: "indicator", indicator: { kind: "ema", length: 9 } }).success,
    ).toBe(true);
    for (const field of priceFields) {
      expect(operandSchema.safeParse({ kind: "price", field }).success).toBe(true);
    }
    expect(operandSchema.safeParse({ kind: "constant", value: "50" }).success).toBe(true);
  });

  it("rejects unknown price fields and numeric constants", () => {
    expect(operandSchema.safeParse({ kind: "price", field: "vwap" }).success).toBe(false);
    expect(operandSchema.safeParse({ kind: "constant", value: 50 }).success).toBe(false);
  });
});

describe("conditionSchema", () => {
  it("lists every condition kind and comparator", () => {
    expect(conditionKinds).toEqual(["compare", "and", "or", "not"]);
    expect(comparators).toEqual([">", ">=", "<", "<=", "==", "!="]);
  });

  it("accepts a comparison with every comparator", () => {
    for (const comparator of comparators) {
      expect(conditionSchema.safeParse({ ...closeAboveSma20, comparator }).success).toBe(true);
    }
  });

  it("accepts nested and/or/not trees", () => {
    const tree: Condition = {
      kind: "and",
      conditions: [
        closeAboveSma20,
        { kind: "or", conditions: [rsiOversold, { kind: "not", condition: rsiOversold }] },
      ],
    };
    expect(conditionSchema.parse(tree)).toEqual(tree);
  });

  it("accepts iv_rank in a comparison", () => {
    const ivRankHigh: Condition = {
      kind: "compare",
      left: { kind: "indicator", indicator: { kind: "iv_rank", lookbackSessions: 252 } },
      comparator: ">",
      right: { kind: "constant", value: "50" },
    };
    expect(conditionSchema.safeParse(ivRankHigh).success).toBe(true);
  });

  it("rejects empty and/or, unknown kinds and comparators", () => {
    expect(conditionSchema.safeParse({ kind: "and", conditions: [] }).success).toBe(false);
    expect(conditionSchema.safeParse({ kind: "xor", conditions: [rsiOversold] }).success).toBe(
      false,
    );
    expect(conditionSchema.safeParse({ ...closeAboveSma20, comparator: "crosses" }).success).toBe(
      false,
    );
  });

  it("rejects a malformed nested condition", () => {
    const tree = {
      kind: "not",
      condition: { kind: "compare", left: { kind: "price", field: "close" } },
    };
    expect(conditionSchema.safeParse(tree).success).toBe(false);
  });

  it("rejects free-form expressions", () => {
    expect(conditionSchema.safeParse("close > sma(20)").success).toBe(false);
  });
});
