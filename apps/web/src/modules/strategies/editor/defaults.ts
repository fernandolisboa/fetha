import { decimalStringSchema, type DecimalString, type StrategyDefinition } from "@fetha/contracts";

import type { CompareCondition } from "./compare-conditions";

const decimal = (value: string): DecimalString => decimalStringSchema.parse(value);

export const defaultCompareCondition: CompareCondition = {
  kind: "compare",
  left: { kind: "indicator", indicator: { kind: "sma", length: 20 } },
  comparator: ">",
  right: { kind: "price", field: "close" },
};

export function emptyDefinition(structureId: string): StrategyDefinition {
  return {
    name: "",
    timeframe: "D1",
    entry: defaultCompareCondition,
    structureId,
    strikes: [],
    sizing: { kind: "fixed_fractional", fraction: decimal("0.1") },
    exit: [],
    adjustments: [],
  };
}
