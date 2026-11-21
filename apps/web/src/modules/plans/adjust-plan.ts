import type { ExitRule, Recipe, RiskProfile, SessionDate, Ticker } from "@fetha/contracts";
import type { LegInput, MarketView } from "@fetha/engine";

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

export interface AdjustedLegInput {
  role: LegInput["role"];
  side: LegInput["side"];
  ticker: Ticker;
}

export interface AdjustPlanInput {
  recipe: Recipe;
  structureId: string;
  structureName: string;
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

// The drag-to-adjust path's own repricing (ticket #380): the user's exact chosen legs (each
// already resolved to a real listed ticker — the caller snaps a drag to the nearest traded
// strike before ever calling this), at the user's own chosen lot count, priced by the same
// two-rung `priceExactLegs` every auto-sized plan uses, so a limit fill can never be beaten by
// what this module reports either. Unlike `generatePlan`, this never sizes on its own and never
// refuses for "does not fit": a breach of the risk limit is surfaced through the engine's own
// `limitBreaches` (shown as a warning, ticket #380), not a refusal — the user asked for this
// exact size.
export async function buildAdjustedPlan(input: AdjustPlanInput): Promise<GeneratePlanResult> {
  const legs: LegInput[] = input.legs.map((leg) => ({
    role: leg.role,
    side: leg.side,
    ticker: leg.ticker,
    quantity: (input.lots * 100) as LegInput["quantity"],
  }));

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
