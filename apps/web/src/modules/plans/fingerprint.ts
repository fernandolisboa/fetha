import type { GeneratedPlan } from "./generate-plan";

// What the plan screen showed and what `savePlanAction` is about to write must be the same plan
// (round 1 review, "save mismatch"): this fingerprints the structure, lot count and legs a
// freshly rebuilt plan resolves to, plus net premium and max loss (round 2 review): a price move
// can leave the structure, lot count and legs untouched while still moving these, and that move
// is exactly what "plan_changed" exists to catch. A limit price itself is still left out — it
// already carries its own tolerance band.
export function planFingerprint(plan: GeneratedPlan): string {
  const legsPart = plan.legs
    .map(({ leg }) => `${leg.side}:${leg.ticker}:${String(leg.quantity)}`)
    .join("|");
  return [
    plan.structureId,
    String(plan.lots),
    legsPart,
    String(plan.netPremiumCentavos),
    String(plan.maxLossCentavos),
  ].join("|");
}
