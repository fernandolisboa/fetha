import { describe, expect, expectTypeOf, it } from "vitest";
import {
  comparators,
  conditionDepth,
  conditionKinds,
  conditionSchema,
  MAX_CONDITION_DEPTH,
  operandSchema,
  priceFields,
  type Condition,
} from "./condition";
import { decimalStringSchema } from "./scalars";

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
  right: { kind: "constant", value: decimalStringSchema.parse("30") },
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

  it("accepts a single-child and/or", () => {
    expect(conditionSchema.safeParse({ kind: "and", conditions: [rsiOversold] }).success).toBe(
      true,
    );
    expect(conditionSchema.safeParse({ kind: "or", conditions: [rsiOversold] }).success).toBe(true);
  });

  it("types and/or children as non-empty tuples, matching the schema's minimum of one", () => {
    expectTypeOf<Extract<Condition, { kind: "and" }>["conditions"]>().toEqualTypeOf<
      [Condition, ...Condition[]]
    >();
    expectTypeOf<Extract<Condition, { kind: "or" }>["conditions"]>().toEqualTypeOf<
      [Condition, ...Condition[]]
    >();
  });

  it("accepts iv_rank in a comparison", () => {
    const ivRankHigh: Condition = {
      kind: "compare",
      left: { kind: "indicator", indicator: { kind: "iv_rank", lookbackSessions: 252 } },
      comparator: ">",
      right: { kind: "constant", value: decimalStringSchema.parse("50") },
    };
    expect(conditionSchema.safeParse(ivRankHigh).success).toBe(true);
  });

  it("rejects empty and/or, unknown kinds and comparators", () => {
    expect(conditionSchema.safeParse({ kind: "and", conditions: [] }).success).toBe(false);
    expect(conditionSchema.safeParse({ kind: "or", conditions: [] }).success).toBe(false);
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

  it("accepts a condition tree at the maximum depth and rejects one level deeper", () => {
    let tree: Condition = closeAboveSma20;
    for (let depth = 1; depth < MAX_CONDITION_DEPTH; depth += 1) {
      tree = { kind: "not", condition: tree };
    }
    expect(conditionDepth(tree)).toBe(MAX_CONDITION_DEPTH);
    expect(conditionSchema.safeParse(tree).success).toBe(true);

    const tooDeep: Condition = { kind: "not", condition: tree };
    expect(conditionDepth(tooDeep)).toBe(MAX_CONDITION_DEPTH + 1);
    expect(conditionSchema.safeParse(tooDeep).success).toBe(false);
  });
});
