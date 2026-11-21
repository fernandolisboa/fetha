import { describe, expect, it } from "vitest";
import { decimalStringSchema } from "@fetha/contracts";

import { isShortLegAssignmentRisk } from "./roll-assignment-risk";

describe("isShortLegAssignmentRisk", () => {
  it("flags a short call strictly in the money", () => {
    expect(
      isShortLegAssignmentRisk(
        "call",
        decimalStringSchema.parse("29.75"),
        decimalStringSchema.parse("30.00"),
      ),
    ).toBe(true);
  });

  it("flags a short call within the builder's own display band but still in the money", () => {
    // 29.75 vs 30.00 is a 0.8% distance, inside the picker's +/-1% "at" band: still a real
    // assignment risk, the exact regression this predicate exists for (#382).
    expect(
      isShortLegAssignmentRisk(
        "call",
        decimalStringSchema.parse("29.75"),
        decimalStringSchema.parse("30.00"),
      ),
    ).toBe(true);
  });

  it("flags a short call exactly at the money", () => {
    expect(
      isShortLegAssignmentRisk(
        "call",
        decimalStringSchema.parse("30.00"),
        decimalStringSchema.parse("30.00"),
      ),
    ).toBe(true);
  });

  it("does not flag a short call out of the money", () => {
    expect(
      isShortLegAssignmentRisk(
        "call",
        decimalStringSchema.parse("30.25"),
        decimalStringSchema.parse("30.00"),
      ),
    ).toBe(false);
  });

  it("flags a short put strictly in the money", () => {
    expect(
      isShortLegAssignmentRisk(
        "put",
        decimalStringSchema.parse("30.25"),
        decimalStringSchema.parse("30.00"),
      ),
    ).toBe(true);
  });

  it("does not flag a short put out of the money", () => {
    expect(
      isShortLegAssignmentRisk(
        "put",
        decimalStringSchema.parse("29.75"),
        decimalStringSchema.parse("30.00"),
      ),
    ).toBe(false);
  });
});
