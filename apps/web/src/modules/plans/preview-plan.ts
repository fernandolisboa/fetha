import { engine, type LegInput, type OperationPricing } from "@fetha/engine";

import type { PlanPreviewContext } from "./actions";
import type { PlanDiffLeg } from "./plan-diff";

// The drag-to-adjust screen's own client-side preview (ticket #380, ADR-0013): `engine` is pure
// TypeScript with no I/O, so it runs the same way in the browser as it does on the server —
// this calls it directly, against the already-loaded, already-scoped `PlanPreviewContext` the
// server handed back with the plan, so every pixel of a drag reprices locally instead of
// round-tripping. Prices at the market's own last price (no `given` price, unlike the two-rung
// limit pricing `adjustPlanAction` does once the server takes over): close enough for a live
// chart, never shown as the plan's own official numbers.
export async function previewPlan(
  context: PlanPreviewContext,
  legs: readonly PlanDiffLeg[],
  lots: number,
): Promise<OperationPricing | null> {
  const legInputs: LegInput[] = legs.map((leg) => ({
    role: leg.role,
    side: leg.side,
    ticker: leg.ticker,
    quantity: (lots * 100) as LegInput["quantity"],
  }));
  const priced = await engine.priceOperation({
    view: context.marketView,
    at: context.at,
    legs: legInputs,
    riskProfile: context.riskProfile,
    openOperationCount: context.openOperationCount,
  });
  return priced.ok ? priced.value : null;
}
