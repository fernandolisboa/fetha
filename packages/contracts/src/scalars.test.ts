import { describe, expect, expectTypeOf, it } from "vitest";
import {
  centavosSchema,
  confidenceSchema,
  decimalStringSchema,
  instantSchema,
  leftOpenUnitIntervalSchema,
  nonNegativeDecimalSchema,
  openUnitIntervalSchema,
  positiveDecimalSchema,
  quantitySchema,
  rightOpenUnitIntervalSchema,
  sessionDateSchema,
  signedQuantitySchema,
  tickerSchema,
  type Centavos,
  type Confidence,
  type DecimalString,
  type Quantity,
  type SignedQuantity,
} from "./scalars";

describe("decimalStringSchema", () => {
  it.each(["0", "12", "12.34", "-0.000125", "1234567.123456"])("accepts %s", (value) => {
    expect(decimalStringSchema.safeParse(value).success).toBe(true);
  });

  it.each(["", "1e5", "012", "1.", ".5", "1,5", "12.34 ", "NaN", "Infinity", "+1"])(
    "rejects %s",
    (value) => {
      expect(decimalStringSchema.safeParse(value).success).toBe(false);
    },
  );

  it("rejects numbers", () => {
    expect(decimalStringSchema.safeParse(12.34).success).toBe(false);
  });

  it("brands the parsed value so a plain string does not type-check as a decimal", () => {
    expectTypeOf<string>().not.toExtend<DecimalString>();
    expectTypeOf(decimalStringSchema.parse("1.5")).toExtend<DecimalString>();
  });
});

describe("decimal ranges", () => {
  it("nonNegativeDecimalSchema accepts zero and positives, rejects negatives", () => {
    expect(nonNegativeDecimalSchema.safeParse("0").success).toBe(true);
    expect(nonNegativeDecimalSchema.safeParse("0.0003").success).toBe(true);
    expect(nonNegativeDecimalSchema.safeParse("-0.01").success).toBe(false);
    expect(nonNegativeDecimalSchema.safeParse("-0").success).toBe(false);
  });

  it("positiveDecimalSchema rejects every spelling of zero", () => {
    expect(positiveDecimalSchema.safeParse("40.00").success).toBe(true);
    expect(positiveDecimalSchema.safeParse("0.01").success).toBe(true);
    for (const zero of ["0", "0.0", "0.000", "-0", "-1"]) {
      expect(positiveDecimalSchema.safeParse(zero).success).toBe(false);
    }
  });

  it("openUnitIntervalSchema is (0, 1)", () => {
    expect(openUnitIntervalSchema.safeParse("0.001").success).toBe(true);
    expect(openUnitIntervalSchema.safeParse("0.999").success).toBe(true);
    for (const outside of ["0", "0.0", "1", "1.0", "1.30", "-0.30"]) {
      expect(openUnitIntervalSchema.safeParse(outside).success).toBe(false);
    }
  });

  it("leftOpenUnitIntervalSchema is (0, 1]", () => {
    for (const inside of ["0.01", "0.5", "1", "1.0", "1.000"]) {
      expect(leftOpenUnitIntervalSchema.safeParse(inside).success).toBe(true);
    }
    for (const outside of ["0", "0.0", "1.01", "2", "-0.5"]) {
      expect(leftOpenUnitIntervalSchema.safeParse(outside).success).toBe(false);
    }
  });

  it("rightOpenUnitIntervalSchema is [0, 1)", () => {
    for (const inside of ["0", "0.0", "0.15", "0.999"]) {
      expect(rightOpenUnitIntervalSchema.safeParse(inside).success).toBe(true);
    }
    for (const outside of ["1", "1.0", "1.5", "-0.1"]) {
      expect(rightOpenUnitIntervalSchema.safeParse(outside).success).toBe(false);
    }
  });
});

describe("confidenceSchema", () => {
  it("accepts [0, 1] inclusive", () => {
    for (const inside of ["0", "0.0", "0.65", "1", "1.00"]) {
      expect(confidenceSchema.safeParse(inside).success).toBe(true);
    }
  });

  it("rejects values outside [0, 1], percentages and numbers", () => {
    for (const outside of ["1.01", "65", "-0.1", "100"]) {
      expect(confidenceSchema.safeParse(outside).success).toBe(false);
    }
    expect(confidenceSchema.safeParse(0.65).success).toBe(false);
  });

  it("is a decimal string but a decimal string is not a confidence", () => {
    expectTypeOf<Confidence>().toExtend<DecimalString>();
    expectTypeOf<DecimalString>().not.toExtend<Confidence>();
  });
});

describe("centavosSchema", () => {
  it("accepts negative, zero and positive integers", () => {
    expect(centavosSchema.safeParse(-250).success).toBe(true);
    expect(centavosSchema.safeParse(0).success).toBe(true);
    expect(centavosSchema.safeParse(123456).success).toBe(true);
  });

  it("rejects fractional amounts and strings", () => {
    expect(centavosSchema.safeParse(1.5).success).toBe(false);
    expect(centavosSchema.safeParse("100").success).toBe(false);
  });

  it("rejects integers outside the safe integer range", () => {
    expect(centavosSchema.safeParse(2 ** 53 + 2).success).toBe(false);
  });

  it("brands the parsed value so a plain number does not type-check as money", () => {
    expectTypeOf<number>().not.toExtend<Centavos>();
    expectTypeOf<Centavos>().not.toExtend<Quantity>();
  });
});

describe("quantitySchema", () => {
  it("accepts positive integers only", () => {
    expect(quantitySchema.safeParse(100).success).toBe(true);
    expect(quantitySchema.safeParse(0).success).toBe(false);
    expect(quantitySchema.safeParse(-1).success).toBe(false);
    expect(quantitySchema.safeParse(1.5).success).toBe(false);
  });
});

describe("signedQuantitySchema", () => {
  it("accepts net long and net short integers, never zero or fractions", () => {
    expect(signedQuantitySchema.safeParse(100).success).toBe(true);
    expect(signedQuantitySchema.safeParse(-100).success).toBe(true);
    expect(signedQuantitySchema.safeParse(0).success).toBe(false);
    expect(signedQuantitySchema.safeParse(-0).success).toBe(false);
    expect(signedQuantitySchema.safeParse(1.5).success).toBe(false);
  });

  it("is a distinct brand from Quantity in both directions", () => {
    expectTypeOf<Quantity>().not.toExtend<SignedQuantity>();
    expectTypeOf<SignedQuantity>().not.toExtend<Quantity>();
    expectTypeOf<number>().not.toExtend<SignedQuantity>();
  });
});

describe("tickerSchema", () => {
  it.each(["PETR4", "BOVA11", "PETRJ400", "VALE3"])("accepts %s", (value) => {
    expect(tickerSchema.safeParse(value).success).toBe(true);
  });

  it.each(["petr4", "PET", "PETR 4", "PETR4.SA", "ABCDEFGHIJKLM"])("rejects %s", (value) => {
    expect(tickerSchema.safeParse(value).success).toBe(false);
  });
});

describe("sessionDateSchema", () => {
  it("accepts an ISO calendar date", () => {
    expect(sessionDateSchema.safeParse("2026-09-09").success).toBe(true);
  });

  it("rejects instants, Brazilian formats and invalid dates", () => {
    expect(sessionDateSchema.safeParse("2026-09-09T20:00:00Z").success).toBe(false);
    expect(sessionDateSchema.safeParse("09/09/2026").success).toBe(false);
    expect(sessionDateSchema.safeParse("2026-13-01").success).toBe(false);
  });
});

describe("instantSchema", () => {
  it("accepts an ISO 8601 UTC instant with millisecond precision", () => {
    expect(instantSchema.safeParse("2026-09-09T20:00:00.000Z").success).toBe(true);
    expect(instantSchema.safeParse("2026-09-09T20:00:00.123Z").success).toBe(true);
  });

  it("rejects instants without millisecond precision", () => {
    expect(instantSchema.safeParse("2026-09-09T20:00:00Z").success).toBe(false);
  });

  it("rejects bare dates and offsets", () => {
    expect(instantSchema.safeParse("2026-09-09").success).toBe(false);
    expect(instantSchema.safeParse("2026-09-09T17:00:00-03:00").success).toBe(false);
    expect(instantSchema.safeParse("2026-09-09T17:00:00.000-03:00").success).toBe(false);
  });
});
