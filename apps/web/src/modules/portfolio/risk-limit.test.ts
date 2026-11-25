import { riskProfileSchema } from "@fetha/contracts";
import { describe, expect, it } from "vitest";

import { riskLimitCentavos } from "./risk-limit";

describe("riskLimitCentavos", () => {
  it("floors the declared capital's own per-operation fraction, in centavos", () => {
    const profile = riskProfileSchema.parse({
      declaredCapital: 1_000_000,
      limits: {
        maxLossPerOperation: "0.02",
        maxExposurePerOperation: "0.1",
        maxOpenOperations: 5,
        maxPremiumBought: "0.05",
      },
    });
    expect(riskLimitCentavos(profile)).toBe(20_000);
  });

  it("never rounds up past what the ratio allows", () => {
    const profile = riskProfileSchema.parse({
      declaredCapital: 333,
      limits: {
        maxLossPerOperation: "0.02",
        maxExposurePerOperation: "0.1",
        maxOpenOperations: 5,
        maxPremiumBought: "0.05",
      },
    });
    expect(riskLimitCentavos(profile)).toBe(6);
  });
});
