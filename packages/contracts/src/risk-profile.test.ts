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

const fractionLimits = ["maxLossPerOperation", "maxExposurePerOperation", "maxPremiumBought"];

describe("riskProfileSchema", () => {
  it("lists every limit", () => {
    expect(riskLimits).toEqual([
      "maxLossPerOperation",
      "maxExposurePerOperation",
      "maxOpenOperations",
      "maxPremiumBought",
    ]);
  });

  it.each(riskLimits)("requires %s", (limit) => {
    const withoutLimit = Object.fromEntries(
      Object.entries(profile.limits).filter(([key]) => key !== limit),
    );
    expect(riskProfileSchema.safeParse({ ...profile, limits: withoutLimit }).success).toBe(false);
  });

  it("accepts a declared capital with limits as fractions", () => {
    expect(riskProfileSchema.parse(profile)).toEqual(profile);
  });

  it("accepts a fraction limit of one", () => {
    for (const limit of fractionLimits) {
      expect(
        riskProfileSchema.safeParse({ ...profile, limits: { ...profile.limits, [limit]: "1" } })
          .success,
      ).toBe(true);
    }
  });

  it("rejects fraction limits of zero, above one or negative", () => {
    for (const limit of fractionLimits) {
      for (const fraction of ["0", "1.5", "-0.1"]) {
        expect(
          riskProfileSchema.safeParse({
            ...profile,
            limits: { ...profile.limits, [limit]: fraction },
          }).success,
        ).toBe(false);
      }
    }
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
