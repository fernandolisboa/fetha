"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
  decimalStringSchema,
  tickerSchema,
  type ContemplatedLeg,
  type DecimalString,
  type PlanRules,
  type Recipe,
  type SessionDate,
  type Structure,
  type Ticker,
} from "@fetha/contracts";
import { engine, type OperationPricing, type OptionRight } from "@fetha/engine";

import { getDb } from "@/db/client";
import { nowInstant } from "@/lib/instant";
import {
  AccountRateLimitExceededError,
  enforceAccountRateLimit,
  requireUser,
  withAuthenticatedAction,
} from "@/modules/auth";
import {
  buildOperationMarketView,
  latestSessionOnOrBefore,
  nthSessionBefore,
} from "@/modules/market-data";
import { countLiveOpenOperations, getCurrentRiskProfile } from "@/modules/portfolio";
import { contemplatedOperations } from "@/modules/portfolio/schema";
import { getSuggestion, SuggestionNotFoundError } from "@/modules/radar";
import { catalog, recipes } from "@/modules/strategies";

import { generatePlan, type GeneratedPlan, type GeneratePlanResult } from "./generate-plan";
import { ivRegimeFromLabel } from "./iv-regime";
import { legSelectionFor } from "./plan-selection";
import { operationPlanRules } from "./schema";
import { recipeForView } from "./select-recipe";
import { planViewSchema, type PlanView } from "./view";

const DEFAULT_TOLERANCE: DecimalString = decimalStringSchema.parse("0.010000");
const MAX_LOTS_PRICED = 50;
const DEFAULT_ROLL_SESSIONS_BEFORE_EXPIRY = 5;

export type PlanActionError =
  "invalid" | "no_data" | "unpriceable" | "does_not_fit" | "rate_limited";

export interface PlanLegSeries {
  right: OptionRight;
  strike: DecimalString;
  expiry: SessionDate;
}

export type BuildPlanOutcome =
  | { status: "ok"; plan: GeneratedPlan; seriesByTicker: Record<string, PlanLegSeries> }
  | { status: "error"; error: PlanActionError; oneLotMaxLossCentavos?: number };

interface ResolvedTarget {
  recipe: Recipe;
  structureId: string;
  structureName: string;
  structure: Structure;
  underlying: Ticker;
  view: PlanView | null;
}

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
// is tested against.
async function resolveFromView(
  underlyingInput: string,
  view: PlanView,
): Promise<ResolvedTarget | null> {
  const parsed = tickerSchema.safeParse(underlyingInput);
  if (!parsed.success) return null;
  const underlying = parsed.data;

  const at = nowInstant();
  const marketView = await buildOperationMarketView(getDb(), underlying, at);
  const reading = await engine.assetReading({ view: marketView, ticker: underlying, at });
  if (!reading.ok) return null;
  const ivRegime = ivRegimeFromLabel(reading.value.impliedVolatility.label);

  const recipe = recipeForView(view, ivRegime, recipes);
  const resolved = recipe ? resolveStructure(recipe) : null;
  if (!recipe || !resolved) return null;
  return {
    recipe,
    structureId: resolved.structureId,
    structureName: resolved.structureName,
    structure: resolved.structure,
    underlying,
    view,
  };
}

// From a suggestion (ticket #379): the suggestion already names its own recipe and structure
// (`SuggestionView`, docs/adr/0067), so the plan copies them rather than matching a view.
async function resolveFromSuggestion(suggestionId: string): Promise<ResolvedTarget | null> {
  try {
    const suggestion = await getSuggestion(suggestionId);
    const underlying = tickerSchema.parse(suggestion.underlying);
    return {
      recipe: suggestion.recipe,
      structureId: suggestion.structure.id,
      structureName: suggestion.structure.name,
      structure:
        catalog.find((entry) => entry.structure.id === suggestion.structure.id)?.structure ??
        (suggestion.structure as Structure),
      underlying,
      view: null,
    };
  } catch (error) {
    if (error instanceof SuggestionNotFoundError) return null;
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

// Builds the deterministic plan for a resolved target (ticket #379): every number is priced by
// the engine's own `priceOperation`, lot by lot (CLAUDE.md principle 1 — this module computes
// no number of its own). Recomputed from scratch on every call, including right before a save,
// so nothing persisted was ever only client-trusted.
async function buildPlan(target: ResolvedTarget): Promise<BuiltPlan> {
  const at = nowInstant();
  const marketView = await buildOperationMarketView(getDb(), target.underlying, at);
  const reading = await engine.assetReading({ view: marketView, ticker: target.underlying, at });
  const ivRegime = ivRegimeFromLabel(reading.ok ? reading.value.impliedVolatility.label : null);

  const riskProfile = await getCurrentRiskProfile();
  if (!riskProfile) {
    return { target, result: { ok: false, reason: "unpriceable" }, seriesByTicker: new Map() };
  }
  const user = await requireUser();
  const openOperationCount = await countLiveOpenOperations(getDb(), user, at);

  const pricingByLots = new Map<number, OperationPricing | null>();
  for (let lots = 1; lots <= MAX_LOTS_PRICED; lots += 1) {
    const priced = await engine.priceOperation({
      view: marketView,
      at,
      legs: legSelectionFor(target.recipe, target.structure, target.underlying, lots),
      riskProfile,
      openOperationCount,
    });
    pricingByLots.set(lots, priced.ok ? priced.value : null);
  }

  const onePricing = pricingByLots.get(1) ?? null;
  const seriesByTicker = onePricing
    ? seriesFactsOf(onePricing, marketView.optionSeries, at)
    : new Map<string, PlanLegSeries>();
  const expiry = expiryOf(seriesByTicker);
  const sessionsByDays = new Map<number, SessionDate | null>();
  if (expiry) {
    for (const days of new Set(daysBeforeExpiryValues(target.recipe))) {
      const session = await nthSessionBefore(getDb(), expiry, days);
      sessionsByDays.set(days, session ? session.date : null);
    }
  }

  const riskLimitCentavos = Math.floor(
    riskProfile.declaredCapital * Number(riskProfile.limits.maxLossPerOperation),
  );

  const result = generatePlan({
    recipe: target.recipe,
    structureId: target.structureId,
    structureName: target.structureName,
    underlying: target.underlying,
    view: target.view,
    ivRegime,
    tolerance: DEFAULT_TOLERANCE,
    riskLimitCentavos,
    pricingForLots: (lots) => pricingByLots.get(lots) ?? null,
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
    };
  }
  if (result.reason === "does_not_fit") {
    return {
      status: "error",
      error: "does_not_fit",
      oneLotMaxLossCentavos: result.oneLotMaxLossCentavos,
    };
  }
  return { status: "error", error: "unpriceable" };
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

async function resolveTarget(input: BuildPlanActionInput): Promise<ResolvedTarget | null> {
  return input.kind === "suggestion"
    ? resolveFromSuggestion(input.suggestionId)
    : resolveFromView(input.underlying, input.view);
}

export async function buildPlanAction(input: unknown): Promise<BuildPlanOutcome> {
  const parsed = buildInputSchema.safeParse(input);
  if (!parsed.success) return { status: "error", error: "invalid" };

  return withAuthenticatedAction(async () => {
    const target = await resolveTarget(parsed.data);
    if (!target) return { status: "error", error: "no_data" };
    const built = await buildPlan(target);
    return toOutcome(built);
  });
}

export type SavePlanResult =
  { status: "ok"; operationId: string } | { status: "error"; error: PlanActionError };

const SAVE_RATE_LIMIT = { windowSeconds: 60, max: 20 };

// Saves the plan `buildPlanAction` already showed the user, re-generated from scratch rather
// than trusted from the client (CLAUDE.md): a contemplated operation, saved exactly the way the
// builder's own `saveOperationAction` saves one (same session resolution, same repository), and
// this plan's own rules row, in one transaction (ADR-0079). Registering the resulting "enter"
// decision in the Diário is the existing `DecisionBar` already shown for any saved contemplated
// operation on `/carteira` — saving a plan does not record a decision on its own, the same as
// saving a built operation never has.
export async function savePlanAction(input: unknown): Promise<SavePlanResult> {
  const parsed = buildInputSchema.safeParse(input);
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

    const target = await resolveTarget(parsed.data);
    if (!target) return { status: "error", error: "no_data" };
    const built = await buildPlan(target);
    if (!built.result.ok) {
      const outcome = toOutcome(built);
      return outcome.status === "error" ? outcome : { status: "error", error: "unpriceable" };
    }
    const { plan } = built.result;

    const session = await latestSessionOnOrBefore(getDb(), new Date(nowInstant()));
    if (!session) return { status: "error", error: "unpriceable" };

    const legs: ContemplatedLeg[] = plan.legs.map(({ leg }) => ({
      role: leg.role,
      side: leg.side,
      ticker: leg.ticker,
      quantity: leg.quantity,
    }));

    const rules: PlanRules = {
      recipeId: target.recipe.id,
      summary: plan.summary,
      exitRules: plan.exitRules,
      roll: plan.roll,
    };

    // One transaction (ADR-0079): the contemplated operation and this plan's own rules are
    // inserted with raw queries against `tx` directly, the same way `PortfolioRepository`'s own
    // multi-step writes do, rather than through a repository built on top of a transaction
    // (`UserScopedRepository` is always constructed on `Database`, never on a `Transaction`).
    const operationId = await getDb().transaction(async (tx) => {
      const [savedOperation] = await tx
        .insert(contemplatedOperations)
        .values({
          userId: user.id,
          structureId: plan.structureId,
          underlying: plan.underlying,
          legs,
          session: session.date,
          netPremiumCentavos: plan.netPremiumCentavos,
          maxLossCentavos: plan.maxLossCentavos === "unbounded" ? null : plan.maxLossCentavos,
          maxGainCentavos: plan.maxGainCentavos === "unbounded" ? null : plan.maxGainCentavos,
          breachedLimits: [],
        })
        .returning({ id: contemplatedOperations.id });
      if (!savedOperation) throw new Error("failed to save contemplated operation");

      await tx.insert(operationPlanRules).values({
        userId: user.id,
        contemplatedOperationId: savedOperation.id,
        recipeId: target.recipe.id,
        rules,
      });
      return savedOperation.id;
    });

    revalidatePath("/carteira");
    return { status: "ok", operationId };
  });
}
