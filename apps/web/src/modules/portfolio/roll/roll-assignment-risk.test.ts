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

  it("flags a short call exactly at the money", () => {
    expect(
      isShortLegAssignmentRisk(
        "call",
        decimalStringSchema.parse("30.00"),
        decimalStringSchema.parse("30.00"),
      ),
    ).toBe(true);
  });

  it("flags a short call out of the money but within the 1% assignment-risk band (#382)", () => {
    expect(
      isShortLegAssignmentRisk(
        "call",
        decimalStringSchema.parse("30.25"),
        decimalStringSchema.parse("30.00"),
      ),
    ).toBe(true);
  });

  it("does not flag a short call clear of the band", () => {
    expect(
      isShortLegAssignmentRisk(
        "call",
        decimalStringSchema.parse("31.00"),
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

  it("flags a short put out of the money but within the 1% assignment-risk band", () => {
    expect(
      isShortLegAssignmentRisk(
        "put",
        decimalStringSchema.parse("29.75"),
        decimalStringSchema.parse("30.00"),
      ),
    ).toBe(true);
  });

  it("does not flag a short put clear of the band", () => {
    expect(
      isShortLegAssignmentRisk(
        "put",
        decimalStringSchema.parse("29.00"),
        decimalStringSchema.parse("30.00"),
      ),
    ).toBe(false);
  });
});
