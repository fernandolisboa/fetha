import {
  decimalStringSchema,
  type Centavos,
  type DecimalString,
  type ExitRule,
  type IvRegime,
  type Recipe,
  type ResolvedExitRule,
  type RollRule,
  type SessionDate,
  type Ticker,
} from "@fetha/contracts";
import type { Leg, OperationPricing } from "@fetha/engine";

import { resolveExitRules, resolveRollRule } from "./exit-rules";
import { limitPriceForLeg } from "./limit-price";
import { chooseLotSize } from "./sizing";
import { t } from "./strings";
import type { PlanView } from "./view";

export interface GeneratedPlanLeg {
  leg: Leg;
  limitPrice: DecimalString;
}

export interface GeneratedPlan {
  structureId: string;
  underlying: Ticker;
  summary: string;
  lots: number;
  legs: GeneratedPlanLeg[];
  netPremiumCentavos: Centavos;
  maxLossCentavos: Centavos | "unbounded";
  maxGainCentavos: Centavos | "unbounded";
  breakEvens: DecimalString[];
  // For the plan screen's payoff chart (docs/adr/0077), the same engine pricing every other
  // number here came from.
  spot: DecimalString;
  payoff: OperationPricing["payoff"];
  payoffNow: OperationPricing["payoffNow"];
  exitRules: ResolvedExitRule[];
  roll: RollRule;
}

export type GeneratePlanResult =
  | { ok: true; plan: GeneratedPlan }
  | { ok: false; reason: "does_not_fit"; oneLotMaxLossCentavos: number }
  | { ok: false; reason: "unpriceable" };

export interface GeneratePlanInput {
  recipe: Recipe;
  structureId: string;
  structureName: string;
  underlying: Ticker;
  // Null: the plan came from a suggestion already matching today's conditions, not a stated
  // view (ticket #379).
  view: PlanView | null;
  ivRegime: IvRegime;
  tolerance: DecimalString;
  riskLimitCentavos: number;
  pricingForLots: (lots: number) => OperationPricing | null;
  sessionsBeforeExpiry: (businessDays: number) => SessionDate | null;
}

function maxLossOf(pricing: OperationPricing): number {
  return pricing.maxLoss === "unbounded" ? Number.MAX_SAFE_INTEGER : pricing.maxLoss;
}

function summaryFor(
  input: Pick<GeneratePlanInput, "structureName" | "underlying" | "view" | "ivRegime">,
): string {
  const ivRegime = t.ivRegimes[input.ivRegime];
  if (input.view === null) {
    return t.summary.fromSuggestion
      .replace("{structure}", input.structureName)
      .replace("{ticker}", input.underlying);
  }
  return t.summary.fromView[input.view]
    .replace("{structure}", input.structureName)
    .replace("{ticker}", input.underlying)
    .replace("{ivRegime}", ivRegime);
}

function legsWithLimitPrice(
  pricing: OperationPricing,
  tolerance: DecimalString,
): GeneratedPlanLeg[] {
  return pricing.legs.map((valuation) => ({
    leg: valuation.leg,
    limitPrice: limitPriceForLeg(
      valuation.leg.side,
      valuation.price ?? decimalStringSchema.parse("0.000000"),
      tolerance,
    ),
  }));
}

// The complete, deterministic operation plan (ticket #379): sizes the recipe's structure in
// lots of 100 to fit the risk profile's per-operation limit, prices every leg's limit from its
// last price and the tolerance, and resolves the recipe's exit and roll rules to concrete
// sessions. Every number comes from `pricingForLots`, which the caller backs with the engine's
// own `priceOperation`; this module never computes a price itself (CLAUDE.md principle 1).
export function generatePlan(input: GeneratePlanInput): GeneratePlanResult {
  const cache = new Map<number, OperationPricing | null>();
  function pricingFor(lots: number): OperationPricing | null {
    if (!cache.has(lots)) cache.set(lots, input.pricingForLots(lots));
    return cache.get(lots) ?? null;
  }

  const sized = chooseLotSize((lots) => {
    const pricing = pricingFor(lots);
    return pricing ? maxLossOf(pricing) : null;
  }, input.riskLimitCentavos);

  if (!sized) return { ok: false, reason: "unpriceable" };
  if (!sized.fits)
    return { ok: false, reason: "does_not_fit", oneLotMaxLossCentavos: sized.maxLossCentavos };

  const pricing = pricingFor(sized.lots);
  if (!pricing) return { ok: false, reason: "unpriceable" };

  const exitRules: ExitRule[] = input.recipe.definition.exit;
  return {
    ok: true,
    plan: {
      structureId: input.structureId,
      underlying: input.underlying,
      summary: summaryFor(input),
      lots: sized.lots,
      legs: legsWithLimitPrice(pricing, input.tolerance),
      netPremiumCentavos: pricing.netPremium,
      maxLossCentavos: pricing.maxLoss,
      maxGainCentavos: pricing.maxGain,
      breakEvens: pricing.breakEvens,
      spot: pricing.spot,
      payoff: pricing.payoff,
      payoffNow: pricing.payoffNow ?? null,
      exitRules: resolveExitRules(exitRules, input.sessionsBeforeExpiry),
      roll: resolveRollRule(input.structureId, exitRules, input.sessionsBeforeExpiry),
    },
  };
}
