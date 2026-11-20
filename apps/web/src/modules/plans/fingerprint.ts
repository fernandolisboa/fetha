import type { GeneratedPlan } from "./generate-plan";

// What the plan screen showed and what `savePlanAction` is about to write must be the same plan
// (round 1 review, "save mismatch"): this fingerprints the structure, lot count and legs a
// freshly rebuilt plan resolves to. Nothing about price is in it — a limit price already carries
// its own tolerance band — only the size and legs the market might have moved since the user
// opened the screen (a strike or expiry the engine's own series selection would now pick
// differently, or a lot count sizing now allows).
export function planFingerprint(plan: GeneratedPlan): string {
  const legsPart = plan.legs
    .map(({ leg }) => `${leg.side}:${leg.ticker}:${String(leg.quantity)}`)
    .join("|");
  return `${plan.structureId}|${String(plan.lots)}|${legsPart}`;
}
