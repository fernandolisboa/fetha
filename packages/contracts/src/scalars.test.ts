import { describe, expect, it } from "vitest";
import {
  centavosSchema,
  decimalStringSchema,
  instantSchema,
  quantitySchema,
  sessionDateSchema,
  tickerSchema,
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
});

describe("quantitySchema", () => {
  it("accepts positive integers only", () => {
    expect(quantitySchema.safeParse(100).success).toBe(true);
    expect(quantitySchema.safeParse(0).success).toBe(false);
    expect(quantitySchema.safeParse(-1).success).toBe(false);
    expect(quantitySchema.safeParse(1.5).success).toBe(false);
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
  it("accepts an ISO 8601 UTC instant", () => {
    expect(instantSchema.safeParse("2026-09-09T20:00:00Z").success).toBe(true);
    expect(instantSchema.safeParse("2026-09-09T20:00:00.000Z").success).toBe(true);
  });

  it("rejects bare dates and offsets", () => {
    expect(instantSchema.safeParse("2026-09-09").success).toBe(false);
    expect(instantSchema.safeParse("2026-09-09T17:00:00-03:00").success).toBe(false);
  });
});
