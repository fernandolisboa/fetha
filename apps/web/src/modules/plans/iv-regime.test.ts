import { decimalStringSchema } from "@fetha/contracts";
import { describe, expect, it } from "vitest";

import { ivDisplayFromLabel, ivRegimeFromReading } from "./iv-regime";

function decimal(value: string) {
  return decimalStringSchema.parse(value);
}

describe("ivRegimeFromReading", () => {
  it("maps low and high straight through", () => {
    expect(ivRegimeFromReading("low", decimal("10.000000"))).toBe("low");
    expect(ivRegimeFromReading("high", decimal("90.000000"))).toBe("high");
  });

  it("resolves normal IV to the nearer regime by rank, never 'any'", () => {
    expect(ivRegimeFromReading("normal", decimal("50.000000"))).toBe("high");
    expect(ivRegimeFromReading("normal", decimal("65.000000"))).toBe("high");
    expect(ivRegimeFromReading("normal", decimal("49.999999"))).toBe("low");
    expect(ivRegimeFromReading("normal", decimal("31.000000"))).toBe("low");
  });

  it("falls back to 'any' only when there is no reading at all", () => {
    expect(ivRegimeFromReading(null, null)).toBe("any");
    expect(ivRegimeFromReading("normal", null)).toBe("any");
  });
});

describe("ivDisplayFromLabel", () => {
  it("names the label the reading actually gave, including normal", () => {
    expect(ivDisplayFromLabel("low")).toBe("low");
    expect(ivDisplayFromLabel("normal")).toBe("normal");
    expect(ivDisplayFromLabel("high")).toBe("high");
  });

  it("names 'any' only when there is no reading at all", () => {
    expect(ivDisplayFromLabel(null)).toBe("any");
  });
});
