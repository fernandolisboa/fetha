import {
  type Centavos,
  type DecimalString,
  type ExitRule,
  type Recipe,
  type ResolvedExitRule,
  type RollRule,
  type SessionDate,
  type Ticker,
} from "@fetha/contracts";
import type { Leg, LimitBreach, OperationPricing } from "@fetha/engine";

import { formatSessionDate } from "@/lib/format/date-time";

import { resolveExitRules, resolveRollRule } from "./exit-rules";
import type { IvDisplay } from "./iv-regime";
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
  limitBreaches: LimitBreach[];
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
  | { ok: false; reason: "unpriceable" }
  | { ok: false; reason: "stale_prices" }
  | { ok: false; reason: "no_market_price" };

// A candidate lot's two rungs (ticket #379, round 1 review item 3/"size and report from limit
// prices"): `probe` prices the structure at the market's own last price, read only to refuse a
// plan whose legs are stale or untraded and to derive the limit price for `final` — a second
// `engine.priceOperation` call pricing the same legs with each leg's own limit price given
// explicitly (`LegInput.price`, the engine's "given" price source), so a limit fill can never
// breach the risk limit the way a last-price estimate could. Every number this module reports
// comes from `final`.
export interface LotPricing {
  probe: OperationPricing;
  final: OperationPricing;
}

export interface GeneratePlanInput {
  recipe: Recipe;
  structureId: string;
  structureName: string;
  underlying: Ticker;
  // Null: the plan came from a suggestion already matching today's conditions, not a stated
  // view (ticket #379).
  view: PlanView | null;
  // The word the summary names today's volatility by (round 2 review): the caller computes
  // this once, on the same reading it used to pick the recipe, and passes it straight
  // through — this module never reads the market a second time for it.
  ivDisplay: IvDisplay;
  // The session whose close every price in this plan comes from (round 2 review item 1): named
  // in the summary so the user knows prices are not live, and the same instant `pricingForLots`
  // was asked to price at.
  priceSessionDate: SessionDate;
  riskLimitCentavos: number;
  // The caller is expected to memoize this (round 2 review "share one pricing cache"): this
  // module calls it once per lot count it needs, trusting a repeat call is free.
  pricingForLots: (lots: number) => Promise<LotPricing | null>;
  sessionsBeforeExpiry: (businessDays: number) => SessionDate | null;
}

function maxLossOf(pricing: OperationPricing): number {
  return pricing.maxLoss === "unbounded" ? Number.MAX_SAFE_INTEGER : pricing.maxLoss;
}

// Exported for the drag-to-adjust path (ticket #380, `adjust-plan.ts`): a user's edited plan
// still owes the same one-sentence reason as Fetha's own, computed from the same inputs.
export function summaryFor(
  input: Pick<
    GeneratePlanInput,
    "structureName" | "underlying" | "view" | "ivDisplay" | "priceSessionDate"
  >,
): string {
  const priceClose = t.summary.priceClose(formatSessionDate(input.priceSessionDate));
  if (input.view === null) {
    return (
      t.summary.fromSuggestion
        .replace("{structure}", input.structureName)
        .replace("{ticker}", input.underlying) + priceClose
    );
  }
  // No IV reading at all (round 4 review): names no regime, rather than the literal word "any",
  // which read as a nonsensical volatility level rather than "we don't know".
  if (input.ivDisplay === "any") {
    return (
      t.summary.fromViewNoIv[input.view]
        .replace("{structure}", input.structureName)
        .replace("{ticker}", input.underlying) + priceClose
    );
  }
  return (
    t.summary.fromView[input.view]
      .replace("{structure}", input.structureName)
      .replace("{ticker}", input.underlying)
      .replace("{ivRegime}", t.ivRegimes[input.ivDisplay]) + priceClose
  );
}

// Legs at their final, given limit price (the `final` rung already echoes back the exact price
// it was told to use), not the last price generatePlan once converted to a limit price itself.
// Exported for the drag-to-adjust path (ticket #380), the same reason `summaryFor` is.
export function legsFromFinal(pricing: OperationPricing): GeneratedPlanLeg[] {
  return pricing.legs.map((valuation) => ({
    leg: valuation.leg,
    // `final` is only ever built from a leg whose own limit price is known (the caller
    // computes it from `probe`), so this is never null in practice; the fallback only guards
    // against a caller that violates that contract.
    limitPrice: valuation.price ?? ("0.000000" as DecimalString),
  }));
}

// The complete, deterministic operation plan (ticket #379): sizes the recipe's structure in
// lots of 100 to fit the risk profile's per-operation limit, pricing one lot count at a time
// (never eagerly every size up to the cap), and resolves the recipe's exit and roll rules to
// concrete sessions. Every number comes from `pricingForLots`'s `final` rung, which the caller
// backs with the engine's own `priceOperation`; this module never computes a price itself
// (CLAUDE.md principle 1). Refuses outright, before sizing, when any leg of the structure has no
// market price or only a stale one: a plan priced against them would be fiction.
export async function generatePlan(input: GeneratePlanInput): Promise<GeneratePlanResult> {
  const onePricing = await input.pricingForLots(1);
  if (!onePricing) return { ok: false, reason: "unpriceable" };
  if (onePricing.probe.legs.some((leg) => leg.stale !== null)) {
    return { ok: false, reason: "stale_prices" };
  }
  if (onePricing.probe.legs.some((leg) => leg.price === null)) {
    return { ok: false, reason: "no_market_price" };
  }

  const sized = await chooseLotSize(async (lots) => {
    const pricing = await input.pricingForLots(lots);
    return pricing ? maxLossOf(pricing.final) : null;
  }, input.riskLimitCentavos);

  if (!sized) return { ok: false, reason: "unpriceable" };
  if (!sized.fits)
    return { ok: false, reason: "does_not_fit", oneLotMaxLossCentavos: sized.maxLossCentavos };

  const pricing = await input.pricingForLots(sized.lots);
  if (!pricing) return { ok: false, reason: "unpriceable" };

  const exitRules: ExitRule[] = input.recipe.definition.exit;
  return {
    ok: true,
    plan: {
      structureId: input.structureId,
      underlying: input.underlying,
      summary: summaryFor(input),
      lots: sized.lots,
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
    },
  };
}
