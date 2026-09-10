import type { CompareCondition } from "./compare-conditions";

export const defaultCompareCondition: CompareCondition = {
  kind: "compare",
  left: { kind: "indicator", indicator: { kind: "sma", length: 20 } },
  comparator: ">",
  right: { kind: "price", field: "close" },
};
