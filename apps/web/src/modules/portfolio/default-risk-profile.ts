import { riskProfileSchema } from "@fetha/contracts";

// What the risk form proposes before the user declares anything, and what features that need a
// profile fall back to (docs/adr/0075): one constant, since the two must change together.
export const DEFAULT_RISK_PROFILE = riskProfileSchema.parse({
  declaredCapital: 5_000_000,
  limits: {
    maxLossPerOperation: "0.02",
    maxExposurePerOperation: "0.1",
    maxOpenOperations: 5,
    maxPremiumBought: "0.05",
  },
});
