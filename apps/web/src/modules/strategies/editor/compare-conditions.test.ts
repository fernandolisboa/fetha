import { describe, expect, it } from "vitest";
import { decimalStringSchema, type Condition } from "@fetha/contracts";

import {
  compareConditionsToEntry,
  fromEditableEntry,
  fromEditableExitCondition,
  toEditableEntry,
  toEditableExitCondition,
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

describe("compareConditionsToEntry", () => {
  it("round-trips a single compare condition", () => {
    const entry = compareConditionsToEntry([closeAboveSma]);
    expect(entry).toEqual(closeAboveSma);
  });

  it("round-trips multiple conditions as an AND", () => {
    const entry = compareConditionsToEntry([closeAboveSma, rsiBelow30]);
    expect(entry).toEqual({ kind: "and", conditions: [closeAboveSma, rsiBelow30] });
  });

  it("throws when building an entry from an empty list", () => {
    expect(() => compareConditionsToEntry([])).toThrow();
  });
});

describe("toEditableEntry / fromEditableEntry", () => {
  it("round-trips a single compare condition as editable", () => {
    const editable = toEditableEntry(closeAboveSma);
    expect(editable).toEqual({ editable: true, conditions: [closeAboveSma] });
    expect(fromEditableEntry(editable)).toEqual(closeAboveSma);
  });

  it("round-trips a flat AND of compares as editable", () => {
    const entry: Condition = { kind: "and", conditions: [closeAboveSma, rsiBelow30] };
    const editable = toEditableEntry(entry);
    expect(editable).toEqual({ editable: true, conditions: [closeAboveSma, rsiBelow30] });
    expect(fromEditableEntry(editable)).toEqual(entry);
  });

  it("preserves an or entry byte-for-byte as a read-only original", () => {
    const orEntry: Condition = { kind: "or", conditions: [closeAboveSma, rsiBelow30] };
    const editable = toEditableEntry(orEntry);
    expect(editable).toEqual({ editable: false, original: orEntry });
    expect(fromEditableEntry(editable)).toBe(orEntry);
  });

  it("preserves a not entry byte-for-byte as a read-only original", () => {
    const notEntry: Condition = { kind: "not", condition: closeAboveSma };
    const editable = toEditableEntry(notEntry);
    expect(editable).toEqual({ editable: false, original: notEntry });
    expect(fromEditableEntry(editable)).toBe(notEntry);
  });

  it("preserves a nested and (not a flat and-of-compares) byte-for-byte", () => {
    const nested: Condition = {
      kind: "and",
      conditions: [closeAboveSma, { kind: "not", condition: rsiBelow30 }],
    };
    const editable = toEditableEntry(nested);
    expect(editable).toEqual({ editable: false, original: nested });
    expect(fromEditableEntry(editable)).toBe(nested);
  });
});

describe("toEditableExitCondition / fromEditableExitCondition", () => {
  it("round-trips a single compare condition as editable", () => {
    const editable = toEditableExitCondition(closeAboveSma);
    expect(editable).toEqual({ editable: true, condition: closeAboveSma });
    expect(fromEditableExitCondition(editable)).toBe(closeAboveSma);
  });

  it("preserves a flat AND of two or more compares byte-for-byte as read-only (exit rows edit one compare only)", () => {
    const twoCompareAnd: Condition = { kind: "and", conditions: [closeAboveSma, rsiBelow30] };
    const editable = toEditableExitCondition(twoCompareAnd);
    expect(editable).toEqual({ editable: false, original: twoCompareAnd });
    expect(fromEditableExitCondition(editable)).toBe(twoCompareAnd);
  });

  it("preserves an or entry byte-for-byte as read-only", () => {
    const orEntry: Condition = { kind: "or", conditions: [closeAboveSma, rsiBelow30] };
    const editable = toEditableExitCondition(orEntry);
    expect(editable).toEqual({ editable: false, original: orEntry });
    expect(fromEditableExitCondition(editable)).toBe(orEntry);
  });

  it("preserves a not entry byte-for-byte as read-only", () => {
    const notEntry: Condition = { kind: "not", condition: closeAboveSma };
    const editable = toEditableExitCondition(notEntry);
    expect(editable).toEqual({ editable: false, original: notEntry });
    expect(fromEditableExitCondition(editable)).toBe(notEntry);
  });
});
