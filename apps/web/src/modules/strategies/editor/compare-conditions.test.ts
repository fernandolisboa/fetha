import { describe, expect, it } from "vitest";
import { decimalStringSchema, type Condition } from "@fetha/contracts";

import {
  compareConditionsToEntry,
  entryToCompareConditions,
  type CompareCondition,
} from "./compare-conditions";

const closeAboveSma: CompareCondition = {
  kind: "compare",
  left: { kind: "indicator", indicator: { kind: "sma", length: 20 } },
  comparator: ">",
  right: { kind: "price", field: "close" },
};

const rsiBelow30: CompareCondition = {
  kind: "compare",
  left: { kind: "indicator", indicator: { kind: "rsi", length: 14 } },
  comparator: "<",
  right: { kind: "constant", value: decimalStringSchema.parse("30") },
};

describe("compareConditionsToEntry / entryToCompareConditions", () => {
  it("round-trips a single compare condition", () => {
    const entry = compareConditionsToEntry([closeAboveSma]);
    expect(entry).toEqual(closeAboveSma);
    expect(entryToCompareConditions(entry, closeAboveSma)).toEqual([closeAboveSma]);
  });

  it("round-trips multiple conditions as an AND", () => {
    const entry = compareConditionsToEntry([closeAboveSma, rsiBelow30]);
    expect(entry).toEqual({ kind: "and", conditions: [closeAboveSma, rsiBelow30] });
    expect(entryToCompareConditions(entry, closeAboveSma)).toEqual([closeAboveSma, rsiBelow30]);
  });

  it("falls back to a default row for a shape the editor cannot represent", () => {
    const orEntry: Condition = { kind: "or", conditions: [closeAboveSma, rsiBelow30] };
    expect(entryToCompareConditions(orEntry, closeAboveSma)).toEqual([closeAboveSma]);
  });

  it("throws when building an entry from an empty list", () => {
    expect(() => compareConditionsToEntry([])).toThrow();
  });
});
