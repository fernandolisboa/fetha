import type { Structure, Ticker } from "@fetha/contracts";
import type { OperationPricing } from "@fetha/engine";

import type { PlanPreviewContext } from "./actions";
import type { PlanDiffLeg } from "./plan-diff";
import { priceExactLegs } from "./reprice-legs";
import { legsFromTemplate } from "./template-legs";

// The drag-to-adjust screen's own client-side preview (ticket #380, ADR-0013): `engine` is pure
// TypeScript with no I/O, so it runs the same way in the browser as it does on the server —
// this calls it directly, against the already-loaded, already-scoped `PlanPreviewContext` the
// server handed back with the plan, so every pixel of a drag reprices locally instead of
// round-tripping. Rebuilds every leg from the structure's own template through
// `legsFromTemplate`, the same function `adjustPlanAction` uses server-side, so a drag preview's
// quantities carry the structure's own ratio (a 1/2/1 butterfly previews as 1/2/1, not a flat
// `lots * 100`) and match the server's own numbers once it replies. Prices with `priceExactLegs`,
// the same two-rung probe-then-limit-price pricing `adjustPlanAction` does once the server takes
// over, and returns its final, limit-priced rung, so the preview's own max loss/gain and
// break-evens never understate what the saved plan will report.
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
  const pricing = await priceExactLegs(
    context.marketView,
    context.at,
    legInputs,
    context.riskProfile,
    context.openOperationCount,
  );
  return pricing ? pricing.final : null;
}
