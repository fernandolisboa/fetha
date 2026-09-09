import { describe, expect, it } from "vitest";
import { riskLimits, riskProfileSchema } from "./risk-profile";

const profile = {
  declaredCapital: 10000000,
  limits: {
    maxLossPerOperation: "0.02",
    maxExposurePerOperation: "0.10",
    maxOpenOperations: 5,
    maxPremiumBought: "0.05",
  },
};

describe("riskProfileSchema", () => {
  it("lists every limit and requires each in the schema", () => {
    expect(riskLimits).toEqual([
      "maxLossPerOperation",
      "maxExposurePerOperation",
      "maxOpenOperations",
      "maxPremiumBought",
    ]);
    expect(Object.keys(riskProfileSchema.shape.limits.shape)).toEqual([...riskLimits]);
  });

  it("accepts a declared capital with limits as fractions", () => {
    expect(riskProfileSchema.parse(profile)).toEqual(profile);
  });

  it("rejects zero or fractional declared capital", () => {
    expect(riskProfileSchema.safeParse({ ...profile, declaredCapital: 0 }).success).toBe(false);
    expect(riskProfileSchema.safeParse({ ...profile, declaredCapital: 100.5 }).success).toBe(false);
  });

  it("rejects zero open operations and numeric fractions", () => {
    expect(
      riskProfileSchema.safeParse({
        ...profile,
        limits: { ...profile.limits, maxOpenOperations: 0 },
      }).success,
    ).toBe(false);
    expect(
      riskProfileSchema.safeParse({
        ...profile,
        limits: { ...profile.limits, maxLossPerOperation: 0.02 },
      }).success,
    ).toBe(false);
  });

  it("rejects unknown limits", () => {
    expect(
      riskProfileSchema.safeParse({ ...profile, limits: { ...profile.limits, maxDrawdown: "0.2" } })
        .success,
    ).toBe(false);
  });
});
