import type {
  ExitRule,
  Recipe,
  RiskProfile,
  SessionDate,
  Structure,
  Ticker,
} from "@fetha/contracts";
import type { MarketView } from "@fetha/engine";

import { resolveExitRules, resolveRollRule } from "./exit-rules";
import {
  legsFromFinal,
  summaryFor,
  type GeneratedPlan,
  type GeneratePlanResult,
} from "./generate-plan";
import type { IvDisplay } from "./iv-regime";
import type { PlanView } from "./view";
import { priceExactLegs } from "./reprice-legs";
import { legsFromTemplate, type AdjustedLegInput } from "./template-legs";

export type { AdjustedLegInput } from "./template-legs";

export interface AdjustPlanInput {
  recipe: Recipe;
  structureId: string;
  structureName: string;
  structure: Structure;
  underlying: Ticker;
  view: PlanView | null;
  ivDisplay: IvDisplay;
  priceSessionDate: SessionDate;
  marketView: MarketView;
  at: string;
  riskProfile: RiskProfile;
  openOperationCount: number;
  legs: readonly AdjustedLegInput[];
  lots: number;
  sessionsBeforeExpiry: (businessDays: number) => SessionDate | null;
}

// The drag-to-adjust path's own repricing (ticket #380): every leg's role, side and quantity
// come from the structure's own template (`legsFromTemplate`), never from a flat `lots * 100` —
// the caller (`buildEdited` in `actions.ts`) has already checked the edit's structural
// conformance (`validateStructuralAdjustment`) before this ever runs, so a mismatched ticker
// count here is only a defensive null, not the normal refusal path. Priced by the same two-rung
// `priceExactLegs` every auto-sized plan uses, so a limit fill can never be beaten by what this
// module reports either. Unlike `generatePlan`, this never sizes on its own and never refuses for
// "does not fit": a breach of the risk limit is surfaced through the engine's own
// `limitBreaches` (shown as a warning, ticket #380), not a refusal — the user asked for this
// exact size.
export async function buildAdjustedPlan(input: AdjustPlanInput): Promise<GeneratePlanResult> {
  const legs = legsFromTemplate(
    input.structure,
    input.underlying,
    input.legs.map((leg) => leg.ticker),
    input.lots,
  );
  if (!legs) return { ok: false, reason: "invalid_adjustment" };

  const pricing = await priceExactLegs(
    input.marketView,
    input.at,
    legs,
    input.riskProfile,
    input.openOperationCount,
  );
  if (!pricing) return { ok: false, reason: "unpriceable" };
  if (pricing.probe.legs.some((leg) => leg.stale !== null)) {
    return { ok: false, reason: "stale_prices" };
  }
  if (pricing.probe.legs.some((leg) => leg.price === null)) {
    return { ok: false, reason: "no_market_price" };
  }

  const exitRules: ExitRule[] = input.recipe.definition.exit;
  const plan: GeneratedPlan = {
    structureId: input.structureId,
    underlying: input.underlying,
    summary: summaryFor(input),
    lots: input.lots,
    legs: legsFromFinal(pricing.final),
    netPremiumCentavos: pricing.final.netPremium,
    maxLossCentavos: pricing.final.maxLoss,
    maxGainCentavos: pricing.final.maxGain,
    breakEvens: pricing.final.breakEvens,
    limitBreaches: pricing.final.limitBreaches,
    spot: pricing.final.spot,
    payoff: pricing.final.payoff,
    payoffNow: pricing.final.payoffNow ?? null,
    exitRules: resolveExitRules(exitRules, input.sessionsBeforeExpiry),
    roll: resolveRollRule(input.structureId, exitRules, input.sessionsBeforeExpiry),
  };
  return { ok: true, plan };
}
