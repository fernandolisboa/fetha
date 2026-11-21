import type { Structure, Ticker } from "@fetha/contracts";
import { engine, type OperationPricing } from "@fetha/engine";

import type { PlanPreviewContext } from "./actions";
import type { PlanDiffLeg } from "./plan-diff";
import { legsFromTemplate } from "./template-legs";

// The drag-to-adjust screen's own client-side preview (ticket #380, ADR-0013): `engine` is pure
// TypeScript with no I/O, so it runs the same way in the browser as it does on the server —
// this calls it directly, against the already-loaded, already-scoped `PlanPreviewContext` the
// server handed back with the plan, so every pixel of a drag reprices locally instead of
// round-tripping. Rebuilds every leg from the structure's own template through
// `legsFromTemplate`, the same function `adjustPlanAction` uses server-side, so a drag preview's
// quantities carry the structure's own ratio (a 1/2/1 butterfly previews as 1/2/1, not a flat
// `lots * 100`) and match the server's own numbers once it replies. Prices at the market's own
// last price (no `given` price, unlike the two-rung limit pricing `adjustPlanAction` does once
// the server takes over): close enough for a live chart, never shown as the plan's own official
// numbers.
export async function previewPlan(
  context: PlanPreviewContext,
  structure: Structure,
  underlying: Ticker,
  legs: readonly PlanDiffLeg[],
  lots: number,
): Promise<OperationPricing | null> {
  const optionTickers: Ticker[] = legs
    .filter((leg) => leg.role !== "stock")
    .map((leg) => leg.ticker);
  const legInputs = legsFromTemplate(structure, underlying, optionTickers, lots);
  if (!legInputs) return null;
  const priced = await engine.priceOperation({
    view: context.marketView,
    at: context.at,
    legs: legInputs,
    riskProfile: context.riskProfile,
    openOperationCount: context.openOperationCount,
  });
  return priced.ok ? priced.value : null;
}
