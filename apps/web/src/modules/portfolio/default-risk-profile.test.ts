import { describe, expect, it } from "vitest";

import { fractionToPercentInputValue } from "@/lib/format/percent";

import { DEFAULT_RISK_PROFILE } from "./default-risk-profile";

describe("DEFAULT_RISK_PROFILE", () => {
  it("is the profile the risk form proposes: R$ 50.000,00, 2%, 10%, 5 operations, 5%", () => {
    expect(DEFAULT_RISK_PROFILE.declaredCapital).toBe(5_000_000);
    expect(fractionToPercentInputValue(DEFAULT_RISK_PROFILE.limits.maxLossPerOperation)).toBe("2");
    expect(fractionToPercentInputValue(DEFAULT_RISK_PROFILE.limits.maxExposurePerOperation)).toBe(
      "10",
    );
    expect(DEFAULT_RISK_PROFILE.limits.maxOpenOperations).toBe(5);
    expect(fractionToPercentInputValue(DEFAULT_RISK_PROFILE.limits.maxPremiumBought)).toBe("5");
  });
});
