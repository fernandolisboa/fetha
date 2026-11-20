"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
  confidenceSchema,
  decimalStringSchema,
  tickerSchema,
  type Confidence,
  type ContemplatedLeg,
  type DecimalString,
  type ExpectedMove,
  type Instant,
  type PlanRules,
  type Recipe,
  type SessionDate,
  type Structure,
  type ThesisClaim,
  type Ticker,
} from "@fetha/contracts";
import { engine, type LegInput, type OperationPricing, type OptionRight } from "@fetha/engine";

import { getDb } from "@/db/client";
import { nowInstant } from "@/lib/instant";
import {
  AccountRateLimitExceededError,
  enforceAccountRateLimit,
  requireUser,
  withAuthenticatedAction,
} from "@/modules/auth";
import { DEFAULT_COST_MODEL } from "@/modules/backtests";
import { isAnalysisAvailable } from "@/modules/ai-models";
import {
  getMyAnalysisUsage,
  DecisionsRepository,
  type RecordDecisionInput,
} from "@/modules/decisions";
import {
  buildOperationMarketView,
  latestSessionOnOrBefore,
  nthSessionBefore,
} from "@/modules/market-data";
import {
  countLiveOpenOperations,
  DEFAULT_RISK_PROFILE,
  getCurrentRiskProfile,
  OperationsRepository,
} from "@/modules/portfolio";
import { getSuggestion, SuggestionNotFoundError } from "@/modules/radar";
import { catalog, recipes } from "@/modules/strategies";

import {
  generatePlan,
  type GeneratedPlan,
  type GeneratePlanResult,
  type LotPricing,
} from "./generate-plan";
import { ivRegimeFromLabel } from "./iv-regime";
import { planFingerprint } from "./fingerprint";
import { filterToMonthlyExpiries } from "./monthly-expiry";
import { legSelectionFor } from "./plan-selection";
import { PlanRulesRepository } from "./plan-rules-repository";
import { limitPriceForLeg } from "./limit-price";
import { riskLimitCentavos } from "./risk-limit";
import { recipeForView } from "./select-recipe";
import { planViewSchema, type PlanView } from "./view";

const DEFAULT_TOLERANCE: DecimalString = decimalStringSchema.parse("0.010000");
const DEFAULT_ROLL_SESSIONS_BEFORE_EXPIRY = 5;
// A decision auto-recorded alongside a saved plan states no conviction of its own (ADR-0079):
// the decision form itself starts with no confidence filled in, so there is no existing default
// to copy; 50% (0.5, the schema's own fraction of 1) is the most neutral value that is still a
// valid confidence.
const AUTO_DECISION_CONFIDENCE: Confidence = confidenceSchema.parse("0.500000");

export type PlanActionError =
  | "invalid"
  | "no_data"
  | "no_recipe"
  | "unpriceable"
  | "does_not_fit"
  | "stale_prices"
  | "no_market_price"
  | "plan_changed"
  | "rate_limited";

export interface PlanLegSeries {
  right: OptionRight;
  strike: DecimalString;
  expiry: SessionDate;
}

export type BuildPlanOutcome =
  | {
      status: "ok";
      plan: GeneratedPlan;
      seriesByTicker: Record<string, PlanLegSeries>;
      fingerprint: string;
    }
  | { status: "error"; error: PlanActionError; oneLotMaxLossCentavos?: number };

interface ResolvedTarget {
  recipe: Recipe;
  structureId: string;
  structureName: string;
  structure: Structure;
  underlying: Ticker;
  view: PlanView | null;
}

type ResolveOutcome =
  { ok: true; target: ResolvedTarget } | { ok: false; reason: "no_data" | "no_recipe" };

function resolveStructure(
  recipe: Recipe,
): { structure: Structure; structureId: string; structureName: string } | null {
  const entry = catalog.find(
    (candidate) => candidate.structure.id === recipe.definition.structureId,
  );
  if (!entry) return null;
  return {
    structure: entry.structure,
    structureId: entry.structure.id,
    structureName: entry.structure.name,
  };
}

// From an underlying and the user's stated view (ticket #379): picks the recipe matching the
// view and today's IV regime, the same matching `apps/web/src/modules/plans/select-recipe.ts`
// is tested against. Distinguishes a data gap ("no_data": no reading for this ticker today)
// from the view admitting no recipe at all ("no_recipe": round 1 review item 2).
async function resolveFromView(underlyingInput: string, view: PlanView): Promise<ResolveOutcome> {
  const parsed = tickerSchema.safeParse(underlyingInput);
  if (!parsed.success) return { ok: false, reason: "no_data" };
  const underlying = parsed.data;

  const at = nowInstant();
  const marketView = await buildOperationMarketView(getDb(), underlying, at);
  const reading = await engine.assetReading({ view: marketView, ticker: underlying, at });
  if (!reading.ok) return { ok: false, reason: "no_data" };
  const ivRegime = ivRegimeFromLabel(reading.value.impliedVolatility.label);

  const recipe = recipeForView(view, ivRegime, recipes);
  if (!recipe) return { ok: false, reason: "no_recipe" };
  const resolved = resolveStructure(recipe);
  if (!resolved) return { ok: false, reason: "no_recipe" };
  return {
    ok: true,
    target: {
      recipe,
      structureId: resolved.structureId,
      structureName: resolved.structureName,
      structure: resolved.structure,
      underlying,
      view,
    },
  };
}

// From a suggestion (ticket #379): the suggestion already names its own recipe and structure
// (`SuggestionView`, docs/adr/0067), so the plan copies them rather than matching a view.
async function resolveFromSuggestion(suggestionId: string): Promise<ResolveOutcome> {
  try {
    const suggestion = await getSuggestion(suggestionId);
    const underlying = tickerSchema.parse(suggestion.underlying);
    return {
      ok: true,
      target: {
        recipe: suggestion.recipe,
        structureId: suggestion.structure.id,
        structureName: suggestion.structure.name,
        structure:
          catalog.find((entry) => entry.structure.id === suggestion.structure.id)?.structure ??
          (suggestion.structure as Structure),
        underlying,
        view: null,
      },
    };
  } catch (error) {
    if (error instanceof SuggestionNotFoundError) return { ok: false, reason: "no_data" };
    throw error;
  }
}

function daysBeforeExpiryValues(recipe: Recipe): number[] {
  return [
    ...recipe.definition.exit.flatMap((rule) =>
      rule.kind === "days_before_expiry" ? [rule.businessDays] : [],
    ),
    DEFAULT_ROLL_SESSIONS_BEFORE_EXPIRY,
  ];
}

// The series facts (right, strike, expiry) behind each option leg's ticker, read the same way
// the radar's own `legsOf` reads them (apps/web/src/modules/radar/read-underlying.ts): the
// latest option series record as of `at` for that ticker. Decodes the orders table's "Call de
// PETR4, strike R$ 36,00, vence 16/01/2027" (ticket #379) without reaching into engine internals.
function seriesFactsOf(
  pricing: OperationPricing,
  optionSeries: Awaited<ReturnType<typeof buildOperationMarketView>>["optionSeries"],
  at: string,
): Map<string, PlanLegSeries> {
  const facts = new Map<string, PlanLegSeries>();
  for (const valuation of pricing.legs) {
    if (valuation.leg.role === "stock" || facts.has(valuation.leg.ticker)) continue;
    const series = optionSeries
      .filter((candidate) => candidate.ticker === valuation.leg.ticker && candidate.asOf <= at)
      .reduce<(typeof optionSeries)[number] | null>(
        (latest, candidate) => (!latest || candidate.asOf > latest.asOf ? candidate : latest),
        null,
      );
    if (series) {
      facts.set(valuation.leg.ticker, {
        right: series.right,
        strike: series.strike,
        expiry: series.expiry,
      });
    }
  }
  return facts;
}

function expiryOf(facts: Map<string, PlanLegSeries>): SessionDate | null {
  return [...facts.values()][0]?.expiry ?? null;
}

interface BuiltPlan {
  target: ResolvedTarget;
  result: GeneratePlanResult;
  seriesByTicker: Map<string, PlanLegSeries>;
}

// One lot's two-rung pricing (generate-plan.ts's `LotPricing`): the probe at the market's own
// last price (also where a stale or untraded leg is caught), then a second call pricing the
// same legs with each leg's own limit price given explicitly, so the numbers this plan reports
// can never be beaten by a limit fill (ticket #379, round 1 review item 3).
async function priceLot(
  view: Awaited<ReturnType<typeof buildOperationMarketView>>,
  at: Instant,
  recipe: Recipe,
  structure: Structure,
  underlying: Ticker,
  lots: number,
  riskProfile: Parameters<typeof engine.priceOperation>[0]["riskProfile"],
  openOperationCount: number,
): Promise<LotPricing | null> {
  const probed = await engine.priceOperation({
    view,
    at,
    legs: legSelectionFor(recipe, structure, underlying, lots),
    riskProfile,
    openOperationCount,
  });
  if (!probed.ok) return null;
  const probe = probed.value;

  const finalLegs: LegInput[] = probe.legs.map((valuation) => ({
    role: valuation.leg.role,
    side: valuation.leg.side,
    ticker: valuation.leg.ticker,
    quantity: valuation.leg.quantity,
    price: limitPriceForLeg(
      valuation.leg.side,
      valuation.price ?? decimalStringSchema.parse("0.000000"),
      DEFAULT_TOLERANCE,
    ),
  }));
  const priced = await engine.priceOperation({
    view,
    at,
    legs: finalLegs,
    riskProfile,
    openOperationCount,
  });
  if (!priced.ok) return null;
  return { probe, final: priced.value };
}

// Builds the deterministic plan for a resolved target (ticket #379): every number is priced by
// the engine's own `priceOperation`, lot by lot (CLAUDE.md principle 1 — this module computes
// no number of its own). Recomputed from scratch on every call, including right before a save,
// so nothing persisted was ever only client-trusted. Falls back to the declared default risk
// profile (docs/adr/0075) when the user has none, the same as every other feature that needs one.
async function buildPlan(target: ResolvedTarget): Promise<BuiltPlan> {
  const at = nowInstant();
  const marketView = filterToMonthlyExpiries(
    await buildOperationMarketView(getDb(), target.underlying, at),
  );
  const reading = await engine.assetReading({ view: marketView, ticker: target.underlying, at });
  const ivRegime = ivRegimeFromLabel(reading.ok ? reading.value.impliedVolatility.label : null);

  const riskProfile = (await getCurrentRiskProfile()) ?? DEFAULT_RISK_PROFILE;
  const user = await requireUser();
  const openOperationCount = await countLiveOpenOperations(getDb(), user, at);

  const pricingForLots = async (lots: number): Promise<LotPricing | null> =>
    priceLot(
      marketView,
      at,
      target.recipe,
      target.structure,
      target.underlying,
      lots,
      riskProfile,
      openOperationCount,
    );

  const onePricing = await pricingForLots(1);
  const seriesByTicker = onePricing
    ? seriesFactsOf(onePricing.probe, marketView.optionSeries, at)
    : new Map<string, PlanLegSeries>();
  const expiry = expiryOf(seriesByTicker);
  const sessionsByDays = new Map<number, SessionDate | null>();
  for (const days of new Set(daysBeforeExpiryValues(target.recipe))) {
    if (days === 0) {
      sessionsByDays.set(0, expiry);
      continue;
    }
    if (!expiry) continue;
    const session = await nthSessionBefore(getDb(), expiry, days);
    sessionsByDays.set(days, session ? session.date : null);
  }

  const result = await generatePlan({
    recipe: target.recipe,
    structureId: target.structureId,
    structureName: target.structureName,
    underlying: target.underlying,
    view: target.view,
    ivRegime,
    riskLimitCentavos: riskLimitCentavos(riskProfile),
    pricingForLots,
    sessionsBeforeExpiry: (businessDays) => sessionsByDays.get(businessDays) ?? null,
  });
  return { target, result, seriesByTicker };
}

function toOutcome(built: BuiltPlan): BuildPlanOutcome {
  const { result } = built;
  if (result.ok) {
    return {
      status: "ok",
      plan: result.plan,
      seriesByTicker: Object.fromEntries(built.seriesByTicker),
      fingerprint: planFingerprint(result.plan),
    };
  }
  if (result.reason === "does_not_fit") {
    return {
      status: "error",
      error: "does_not_fit",
      oneLotMaxLossCentavos: result.oneLotMaxLossCentavos,
    };
  }
  return { status: "error", error: result.reason };
}

const fromViewInputSchema = z.strictObject({
  kind: z.literal("view"),
  underlying: z.string(),
  view: planViewSchema,
});
const fromSuggestionInputSchema = z.strictObject({
  kind: z.literal("suggestion"),
  suggestionId: z.string().min(1),
});
const buildInputSchema = z.union([fromViewInputSchema, fromSuggestionInputSchema]);
export type BuildPlanActionInput = z.infer<typeof buildInputSchema>;

const saveInputSchema = z.union([
  fromViewInputSchema.extend({ fingerprint: z.string().min(1) }),
  fromSuggestionInputSchema.extend({ fingerprint: z.string().min(1) }),
]);
export type SavePlanActionInput = z.infer<typeof saveInputSchema>;

async function resolveTarget(input: BuildPlanActionInput): Promise<ResolveOutcome> {
  return input.kind === "suggestion"
    ? resolveFromSuggestion(input.suggestionId)
    : resolveFromView(input.underlying, input.view);
}

const BUILD_RATE_LIMIT = { windowSeconds: 60, max: 60 };

export async function buildPlanAction(input: unknown): Promise<BuildPlanOutcome> {
  const parsed = buildInputSchema.safeParse(input);
  if (!parsed.success) return { status: "error", error: "invalid" };

  return withAuthenticatedAction(async () => {
    const user = await requireUser();
    try {
      await enforceAccountRateLimit(getDb(), user.email, "plans/build", BUILD_RATE_LIMIT);
    } catch (error) {
      if (error instanceof AccountRateLimitExceededError) {
        return { status: "error", error: "rate_limited" };
      }
      throw error;
    }

    const resolved = await resolveTarget(parsed.data);
    if (!resolved.ok) return { status: "error", error: resolved.reason };
    const built = await buildPlan(resolved.target);
    return toOutcome(built);
  });
}

export interface SavePlanAnalysisEntryPoint {
  usage: { used: number; cap: number };
  available: boolean;
}

export type SavePlanResult =
  | { status: "ok"; operationId: string; analysis: SavePlanAnalysisEntryPoint }
  | { status: "error"; error: PlanActionError };

const SAVE_RATE_LIMIT = { windowSeconds: 60, max: 20 };

function claimForMove(move: ExpectedMove, underlying: Ticker, spot: DecimalString): ThesisClaim {
  switch (move) {
    case "up":
      return { kind: "close_above", instrument: underlying, level: spot };
    case "down":
      return { kind: "close_below", instrument: underlying, level: spot };
    case "sideways":
    case "big_move":
      return { kind: "operation_pnl_positive" };
  }
}

// The plan's own exit date when it has one (the first resolved exit rule that names a session),
// falling back to the structure's shared option expiry — the same rule `deriveDefaultHorizon`
// (decisions/horizon.ts) applies to any other saved operation (ADR-0079).
function planHorizon(plan: GeneratedPlan, fallbackExpiry: SessionDate | null): SessionDate | null {
  const exitSession = plan.exitRules.find((rule) => rule.session !== null)?.session ?? null;
  return exitSession ?? fallbackExpiry;
}

// Saves the plan `buildPlanAction` already showed the user, re-generated from scratch rather
// than trusted from the client (CLAUDE.md), through the same repositories a builder-saved
// operation uses (`OperationsRepository`) and this plan's own rules (`PlanRulesRepository`), plus
// the resulting "enter" decision (`DecisionsRepository`) — all three in one transaction
// (ADR-0079). Refuses with "plan_changed" when the freshly rebuilt plan's fingerprint no longer
// matches the one the user reviewed: the market moved enough to pick different legs or a
// different lot count since the screen was shown.
export async function savePlanAction(input: unknown): Promise<SavePlanResult> {
  const parsed = saveInputSchema.safeParse(input);
  if (!parsed.success) return { status: "error", error: "invalid" };

  return withAuthenticatedAction(async () => {
    const user = await requireUser();
    try {
      await enforceAccountRateLimit(getDb(), user.email, "plans/save", SAVE_RATE_LIMIT);
    } catch (error) {
      if (error instanceof AccountRateLimitExceededError) {
        return { status: "error", error: "rate_limited" };
      }
      throw error;
    }

    const resolved = await resolveTarget(parsed.data);
    if (!resolved.ok) return { status: "error", error: resolved.reason };
    const target = resolved.target;
    const built = await buildPlan(target);
    if (!built.result.ok) {
      const outcome = toOutcome(built);
      return outcome.status === "error" ? outcome : { status: "error", error: "unpriceable" };
    }
    const { plan } = built.result;

    if (planFingerprint(plan) !== parsed.data.fingerprint) {
      return { status: "error", error: "plan_changed" };
    }

    const session = await latestSessionOnOrBefore(getDb(), new Date(nowInstant()));
    if (!session) return { status: "error", error: "unpriceable" };

    const legs: ContemplatedLeg[] = plan.legs.map(({ leg }) => ({
      role: leg.role,
      side: leg.side,
      ticker: leg.ticker,
      quantity: leg.quantity,
    }));
    const breachedLimits = plan.limitBreaches.map((breach) => breach.limit);

    const rules: PlanRules = {
      recipeId: target.recipe.id,
      summary: plan.summary,
      exitRules: plan.exitRules,
      roll: plan.roll,
    };

    const operationsRepo = new OperationsRepository(getDb(), user);
    const planRulesRepo = new PlanRulesRepository(getDb(), user);
    const decisionsRepo = new DecisionsRepository(getDb(), user);
    const expiry = expiryOf(built.seriesByTicker);
    const horizon = planHorizon(plan, expiry);

    const operationId = await getDb().transaction(async (tx) => {
      const { id } = await operationsRepo.save(
        {
          structureId: plan.structureId,
          underlying: plan.underlying,
          legs,
          session: session.date,
          netPremiumCentavos: plan.netPremiumCentavos,
          maxLossCentavos: plan.maxLossCentavos === "unbounded" ? null : plan.maxLossCentavos,
          maxGainCentavos: plan.maxGainCentavos === "unbounded" ? null : plan.maxGainCentavos,
          breachedLimits,
        },
        tx,
      );

      await planRulesRepo.save(
        { contemplatedOperationId: id, recipeId: target.recipe.id, rules },
        tx,
      );

      // No horizon resolves only for a stock-only structure with no dated exit rule either
      // (ADR-0079): rare in the recipe book today, and nothing a decision could date without
      // asking the user, so the plan still saves, just without an auto-recorded decision.
      if (horizon) {
        const recordInput: RecordDecisionInput = {
          kind: "enter",
          originKind: "contemplated_operation",
          signalId: null,
          contemplatedOperationId: id,
          strategyVersionId: null,
          inputs: {
            originKind: "contemplated_operation",
            underlying: plan.underlying,
            structureId: plan.structureId,
            structureName: target.structureName,
            legs,
            session: session.date,
            netPremiumCentavos: plan.netPremiumCentavos,
            maxLossCentavos: plan.maxLossCentavos === "unbounded" ? null : plan.maxLossCentavos,
            maxGainCentavos: plan.maxGainCentavos === "unbounded" ? null : plan.maxGainCentavos,
            breachedLimits,
          },
          rationale: plan.summary,
          claim: claimForMove(target.recipe.expectedMove, plan.underlying, plan.spot),
          confidence: AUTO_DECISION_CONFIDENCE,
          horizon,
          costModel: DEFAULT_COST_MODEL,
        };
        await decisionsRepo.record(recordInput, tx);
      }

      return id;
    });

    const [usage, available] = await Promise.all([getMyAnalysisUsage(), isAnalysisAvailable()]);

    revalidatePath("/carteira");
    revalidatePath("/diario");
    return { status: "ok", operationId, analysis: { usage, available } };
  });
}
