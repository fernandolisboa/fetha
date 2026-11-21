import { describe, expect, it } from "vitest";
import { decimalStringSchema, type Operand } from "@fetha/contracts";

import type { RadarFacts } from "../match";
import { observeOperand } from "./radar-facts";

const decimal = (value: string) => decimalStringSchema.parse(value);

const facts: RadarFacts = {
  close: decimal("45.70"),
  indicators: [
    { indicator: { kind: "rsi", length: 14 }, value: decimal("45.7") },
    { indicator: { kind: "sma", length: 50 }, value: decimal("40") },
  ],
};

describe("observeOperand", () => {
  it("reads the close for a price operand", () => {
    const operand: Operand = { kind: "price", field: "close" };
    expect(observeOperand(operand, facts)).toBe("R$ 45,70");
  });

  it("reads the matching indicator's own value for an indicator operand", () => {
    const operand: Operand = { kind: "indicator", indicator: { kind: "rsi", length: 14 } };
    expect(observeOperand(operand, facts)).toBe("45,7");
  });

  it("gives nothing for an indicator the facts never recorded", () => {
    const operand: Operand = { kind: "indicator", indicator: { kind: "ema", length: 9 } };
    expect(observeOperand(operand, facts)).toBeNull();
  });

  it("gives nothing for a constant operand", () => {
    const operand: Operand = { kind: "constant", value: decimal("70") };
    expect(observeOperand(operand, facts)).toBeNull();
  });
});
