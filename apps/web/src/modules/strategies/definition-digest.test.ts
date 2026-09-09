import { describe, expect, it } from "vitest";

import { computeDefinitionDigest } from "./definition-digest";
import type { DecimalString, StrategyDefinition } from "@fetha/contracts";

function decimalString(value: string): DecimalString {
  return value as DecimalString;
}

const definition: StrategyDefinition = {
  name: "SMA cruza acima",
  timeframe: "D1",
  entry: {
    kind: "compare",
    left: { kind: "indicator", indicator: { kind: "sma", length: 20 } },
    comparator: ">",
    right: { kind: "price", field: "close" },
  },
  structureId: "stock",
  strikes: [],
  sizing: { kind: "fixed_fractional", fraction: decimalString("0.1") },
  exit: [],
  adjustments: [],
};

describe("computeDefinitionDigest", () => {
  it("is stable for the same definition regardless of key order", () => {
    const reordered = {
      timeframe: definition.timeframe,
      name: definition.name,
      entry: definition.entry,
      exit: definition.exit,
      structureId: definition.structureId,
      strikes: definition.strikes,
      sizing: definition.sizing,
      adjustments: definition.adjustments,
    } as StrategyDefinition;

    expect(computeDefinitionDigest(reordered)).toBe(computeDefinitionDigest(definition));
  });

  it("differs when a field changes", () => {
    const changed: StrategyDefinition = { ...definition, name: "Outro nome" };

    expect(computeDefinitionDigest(changed)).not.toBe(computeDefinitionDigest(definition));
  });

  it("produces a 64-character hex sha256 digest", () => {
    expect(computeDefinitionDigest(definition)).toMatch(/^[0-9a-f]{64}$/);
  });
});
