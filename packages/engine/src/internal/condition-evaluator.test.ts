import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";
import type { Condition } from "@fetha/contracts";
import type { Candle } from "../api";
import { decimalString } from "../test/support";
import { evaluateCondition, indicatorSpecKey } from "./condition-evaluator";

const candle: Candle = {
  ticker: "PETR4",
  timeframe: "D1",
  session: "2024-01-10",
  asOf: "2024-01-10T20:00:00.000Z",
  open: decimalString("10.00"),
  high: decimalString("11.00"),
  low: decimalString("9.50"),
  close: decimalString("10.50"),
  tradedQuantity: 1000,
};

const sma20Key = indicatorSpecKey({ kind: "sma", length: 20 });

const context = (indicatorValues: Map<string, Decimal | null>) => ({ candle, indicatorValues });

describe("evaluateCondition", () => {
  it("evaluates a compare condition on close > constant as true", () => {
    const condition: Condition = {
      kind: "compare",
      left: { kind: "price", field: "close" },
      comparator: ">",
      right: { kind: "constant", value: decimalString("10") },
    };
    expect(evaluateCondition(condition, context(new Map()))).toBe("true");
  });

  it("evaluates close < constant as false", () => {
    const condition: Condition = {
      kind: "compare",
      left: { kind: "price", field: "close" },
      comparator: "<",
      right: { kind: "constant", value: decimalString("10") },
    };
    expect(evaluateCondition(condition, context(new Map()))).toBe("false");
  });

  it("compares close against an indicator value", () => {
    const condition: Condition = {
      kind: "compare",
      left: { kind: "price", field: "close" },
      comparator: ">",
      right: { kind: "indicator", indicator: { kind: "sma", length: 20 } },
    };
    const above = context(new Map([[sma20Key, new Decimal("10.00")]]));
    expect(evaluateCondition(condition, above)).toBe("true");

    const below = context(new Map([[sma20Key, new Decimal("11.00")]]));
    expect(evaluateCondition(condition, below)).toBe("false");
  });

  it("returns unknown when an indicator is not yet seeded (null)", () => {
    const condition: Condition = {
      kind: "compare",
      left: { kind: "price", field: "close" },
      comparator: ">",
      right: { kind: "indicator", indicator: { kind: "sma", length: 20 } },
    };
    expect(evaluateCondition(condition, context(new Map([[sma20Key, null]])))).toBe("unknown");
  });

  it("reads tradedQuantity as a numeric price field", () => {
    const condition: Condition = {
      kind: "compare",
      left: { kind: "price", field: "tradedQuantity" },
      comparator: ">=",
      right: { kind: "constant", value: decimalString("1000") },
    };
    expect(evaluateCondition(condition, context(new Map()))).toBe("true");
  });

  it.each([
    [">", "10.60", "false"],
    [">=", "10.50", "true"],
    ["<", "10.40", "false"],
    ["<=", "10.50", "true"],
    ["==", "10.50", "true"],
    ["!=", "10.50", "false"],
  ] as const)("comparator %s against %s yields %s", (comparator, value, expected) => {
    const condition: Condition = {
      kind: "compare",
      left: { kind: "price", field: "close" },
      comparator,
      right: { kind: "constant", value: decimalString(value) },
    };
    expect(evaluateCondition(condition, context(new Map()))).toBe(expected);
  });

  it("and is false when any branch is false, even if another is unknown", () => {
    const falseBranch: Condition = {
      kind: "compare",
      left: { kind: "price", field: "close" },
      comparator: "<",
      right: { kind: "constant", value: decimalString("0") },
    };
    const unknownBranch: Condition = {
      kind: "compare",
      left: { kind: "price", field: "close" },
      comparator: ">",
      right: { kind: "indicator", indicator: { kind: "sma", length: 20 } },
    };
    const condition: Condition = { kind: "and", conditions: [falseBranch, unknownBranch] };
    expect(evaluateCondition(condition, context(new Map([[sma20Key, null]])))).toBe("false");
  });

  it("and is unknown when no branch is false but one is unknown", () => {
    const trueBranch: Condition = {
      kind: "compare",
      left: { kind: "price", field: "close" },
      comparator: ">",
      right: { kind: "constant", value: decimalString("0") },
    };
    const unknownBranch: Condition = {
      kind: "compare",
      left: { kind: "price", field: "close" },
      comparator: ">",
      right: { kind: "indicator", indicator: { kind: "sma", length: 20 } },
    };
    const condition: Condition = { kind: "and", conditions: [trueBranch, unknownBranch] };
    expect(evaluateCondition(condition, context(new Map([[sma20Key, null]])))).toBe("unknown");
  });

  it("and is true only when every branch is true", () => {
    const trueBranch: Condition = {
      kind: "compare",
      left: { kind: "price", field: "close" },
      comparator: ">",
      right: { kind: "constant", value: decimalString("0") },
    };
    const condition: Condition = { kind: "and", conditions: [trueBranch, trueBranch] };
    expect(evaluateCondition(condition, context(new Map()))).toBe("true");
  });

  it("or is true when any branch is true, even if another is unknown", () => {
    const trueBranch: Condition = {
      kind: "compare",
      left: { kind: "price", field: "close" },
      comparator: ">",
      right: { kind: "constant", value: decimalString("0") },
    };
    const unknownBranch: Condition = {
      kind: "compare",
      left: { kind: "price", field: "close" },
      comparator: ">",
      right: { kind: "indicator", indicator: { kind: "sma", length: 20 } },
    };
    const condition: Condition = { kind: "or", conditions: [trueBranch, unknownBranch] };
    expect(evaluateCondition(condition, context(new Map([[sma20Key, null]])))).toBe("true");
  });

  it("or is unknown when no branch is true but one is unknown", () => {
    const falseBranch: Condition = {
      kind: "compare",
      left: { kind: "price", field: "close" },
      comparator: "<",
      right: { kind: "constant", value: decimalString("0") },
    };
    const unknownBranch: Condition = {
      kind: "compare",
      left: { kind: "price", field: "close" },
      comparator: ">",
      right: { kind: "indicator", indicator: { kind: "sma", length: 20 } },
    };
    const condition: Condition = { kind: "or", conditions: [falseBranch, unknownBranch] };
    expect(evaluateCondition(condition, context(new Map([[sma20Key, null]])))).toBe("unknown");
  });

  it("or is false only when every branch is false", () => {
    const falseBranch: Condition = {
      kind: "compare",
      left: { kind: "price", field: "close" },
      comparator: "<",
      right: { kind: "constant", value: decimalString("0") },
    };
    const condition: Condition = { kind: "or", conditions: [falseBranch, falseBranch] };
    expect(evaluateCondition(condition, context(new Map()))).toBe("false");
  });

  it("not negates true and false but leaves unknown untouched", () => {
    const trueBranch: Condition = {
      kind: "compare",
      left: { kind: "price", field: "close" },
      comparator: ">",
      right: { kind: "constant", value: decimalString("0") },
    };
    const unknownBranch: Condition = {
      kind: "compare",
      left: { kind: "price", field: "close" },
      comparator: ">",
      right: { kind: "indicator", indicator: { kind: "sma", length: 20 } },
    };
    expect(evaluateCondition({ kind: "not", condition: trueBranch }, context(new Map()))).toBe(
      "false",
    );
    expect(
      evaluateCondition(
        { kind: "not", condition: unknownBranch },
        context(new Map([[sma20Key, null]])),
      ),
    ).toBe("unknown");
  });

  it("evaluates a tree combining and/or/not", () => {
    const closeAboveZero: Condition = {
      kind: "compare",
      left: { kind: "price", field: "close" },
      comparator: ">",
      right: { kind: "constant", value: decimalString("0") },
    };
    const closeAboveSma: Condition = {
      kind: "compare",
      left: { kind: "price", field: "close" },
      comparator: ">",
      right: { kind: "indicator", indicator: { kind: "sma", length: 20 } },
    };
    const tree: Condition = {
      kind: "and",
      conditions: [closeAboveZero, { kind: "not", condition: closeAboveSma }],
    };
    expect(evaluateCondition(tree, context(new Map([[sma20Key, new Decimal("100.00")]])))).toBe(
      "true",
    );
  });

  it("keys iv_rank indicator specs by lookbackSessions, not length", () => {
    expect(indicatorSpecKey({ kind: "iv_rank", lookbackSessions: 10 })).not.toBe(
      indicatorSpecKey({ kind: "iv_rank", lookbackSessions: 20 }),
    );
    expect(indicatorSpecKey({ kind: "sma", length: 10 })).not.toBe(
      indicatorSpecKey({ kind: "ema", length: 10 }),
    );
  });
});
