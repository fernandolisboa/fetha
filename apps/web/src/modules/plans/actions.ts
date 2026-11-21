"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
  confidenceSchema,
  tickerSchema,
  type Confidence,
  type ContemplatedLeg,
  type DecimalString,
  type ExpectedMove,
  type Instant,
  type PlanRules,
  type Recipe,
  type RiskProfile,
  type SessionDate,
  type Structure,
  type ThesisClaim,
  type Ticker,
} from "@fetha/contracts";
import { engine, type MarketView, type OptionRight } from "@fetha/engine";

import { getDb } from "@/db/client";
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
  latestCandle,
  nthSessionBefore,
  tradingSessionForDate,
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
import { buildAdjustedPlan, type AdjustedLegInput } from "./adjust-plan";
import { chainFromMonthlyView, expiryOptionsFrom, type PlanChainEntry } from "./chain-view";
import { ivDisplayFromLabel, ivRegimeFromReading, type IvDisplay } from "./iv-regime";
import { planFingerprint } from "./fingerprint";
import { filterToMonthlyExpiries } from "./monthly-expiry";
import { filterToTradedSeries } from "./traded-series";
import { legSelectionFor } from "./plan-selection";
import { isWithinPlanWindow } from "./plan-window";
import { PlanRulesRepository } from "./plan-rules-repository";
import { priceFromProbe } from "./reprice-legs";
import { riskLimitCentavos } from "./risk-limit";
import { recipeForView } from "./select-recipe";
import { validateStructuralAdjustment } from "./validate-adjustment";
import { planViewSchema, type PlanView } from "./view";

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
  | "rate_limited"
  | "invalid_adjustment";

export interface PlanLegSeries {
  // The series' own underlying: the ticket's decoded order line names it, not the option
  // series' own ticker — a trader reads an order by what it is on, not by the chain's internal
  // code.
  underlying: Ticker;
  right: OptionRight;
  strike: DecimalString;
  expiry: SessionDate;
}

// What the drag-to-adjust screen needs to preview an edit client-side (ticket #380), without a
// round trip for every pixel of a drag: the same, already-scoped-to-this-underlying market
// view, pricing instant, risk profile and open-operation count every number on the read-only
// screen already came from. `engine.priceOperation` is pure (ADR-0013), so the client calls it
// directly on this; only the number shown as official, after a release or a button press, comes
// from the server (`adjustPlanAction`).
export interface PlanPreviewContext {
  marketView: MarketView;
  at: Instant;
  riskProfile: RiskProfile;
  openOperationCount: number;
}

export type BuildPlanOutcome =
  | {
      status: "ok";
      plan: GeneratedPlan;
      seriesByTicker: Record<string, PlanLegSeries>;
      fingerprint: string;
      riskLimitCentavos: number;
      chain: PlanChainEntry[];
      expiryOptions: SessionDate[];
      preview: PlanPreviewContext;
      // The structure's own template (ticket #380): the client identifies and bounds each leg
      // by its position here (role, side, ratio, strike rank), never by role+side alone, which
      // collides for a butterfly's two same-role, same-side wings.
      structure: Structure;
    }
  | { status: "error"; error: PlanActionError; oneLotMaxLossCentavos?: number };

interface ResolvedTarget {
  recipe: Recipe;
  structureId: string;
  structureName: string;
  structure: Structure;
  underlying: Ticker;
  view: PlanView | null;
  ivDisplay: IvDisplay;
  session: PricingSession;
  // Already built when `resolveFromView` needed it for its own IV reading ("build the market
  // view once per request"); `buildPlan` reuses it instead of asking
  // `buildOperationMarketView` a second time. Undefined for a suggestion-origin target, which
  // never needed one of its own — `buildPlan` builds it fresh there, exactly as before.
  marketView: MarketView | undefined;
}

type ResolveOutcome =
  { ok: true; target: ResolvedTarget } | { ok: false; reason: "no_data" | "no_recipe" };

// The session every price in a plan comes from: the newest session this underlying actually has
// an ingested candle for, not the newest closed session on
// the calendar — between a session's close and the nightly ingestion finishing (or after a failed
// ingestion run), the calendar already considers that session closed but no price for it exists
// yet, which would mark every leg stale against a close nothing was ever priced at. The same
// anchor `apps/web/src/modules/radar/e2e-seed.ts` resolves a session by. `at` is that session's
// own close instant, so the engine's own "session of `at`" resolves to this same session.
interface PricingSession {
  date: SessionDate;
  at: Instant;
}

async function resolvePricingSessionFor(underlying: Ticker): Promise<PricingSession | null> {
  const candle = await latestCandle(getDb(), underlying);
  if (!candle) return null;
  const trading = await tradingSessionForDate(getDb(), candle.session);
  if (!trading) return null;
  return { date: trading.date, at: trading.close };
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
// is tested against. Distinguishes a data gap ("no_data": no reading for this ticker today)
// from the view admitting no recipe at all ("no_recipe").
async function resolveFromView(underlyingInput: string, view: PlanView): Promise<ResolveOutcome> {
  const parsed = tickerSchema.safeParse(underlyingInput);
  if (!parsed.success) return { ok: false, reason: "no_data" };
  const underlying = parsed.data;

  const session = await resolvePricingSessionFor(underlying);
  if (!session) return { ok: false, reason: "no_data" };
  const { at } = session;
  const marketView = await buildOperationMarketView(getDb(), underlying, at);
  const reading = await engine.assetReading({ view: marketView, ticker: underlying, at });
  if (!reading.ok) return { ok: false, reason: "no_data" };
  const { label, ivRank } = reading.value.impliedVolatility;
  const ivRegime = ivRegimeFromReading(label, ivRank);

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
      ivDisplay: ivDisplayFromLabel(label),
      session,
      marketView,
    },
  };
}

// From a suggestion (ticket #379): the suggestion already names its own recipe and structure
// (`SuggestionView`, docs/adr/0067), so the plan copies them rather than matching a view.
async function resolveFromSuggestion(suggestionId: string): Promise<ResolveOutcome> {
  try {
    const suggestion = await getSuggestion(suggestionId);
    const underlying = tickerSchema.parse(suggestion.underlying);
    const session = await resolvePricingSessionFor(underlying);
    if (!session) return { ok: false, reason: "no_data" };
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
        // The summary for a suggestion-origin plan never names an IV regime (`t.summary.
        // fromSuggestion` has no `{ivRegime}` placeholder), so this value is unused.
        ivDisplay: "any",
        session,
        marketView: undefined,
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
  legs: readonly { leg: { role: string; ticker: Ticker } }[],
  optionSeries: Awaited<ReturnType<typeof buildOperationMarketView>>["optionSeries"],
  at: string,
): Map<string, PlanLegSeries> {
  const facts = new Map<string, PlanLegSeries>();
  for (const valuation of legs) {
    if (valuation.leg.role === "stock" || facts.has(valuation.leg.ticker)) continue;
    const series = optionSeries
      .filter((candidate) => candidate.ticker === valuation.leg.ticker && candidate.asOf <= at)
      .reduce<(typeof optionSeries)[number] | null>(
        (latest, candidate) => (!latest || candidate.asOf > latest.asOf ? candidate : latest),
        null,
      );
    if (series) {
      facts.set(valuation.leg.ticker, {
        underlying: series.underlying,
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

interface PlanContext {
  at: Instant;
  date: SessionDate;
  monthlyView: MarketView;
  marketView: MarketView;
  chain: PlanChainEntry[];
  expiryOptions: SessionDate[];
  riskProfile: RiskProfile;
  openOperationCount: number;
  limitCentavos: number;
}

// Everything `buildPlan` and `buildEdited` both need before they diverge into auto-sizing versus
// pricing the user's own chosen legs: the session's own market view narrowed to monthly, traded
// series, the chain and its expiry chips, the user's risk profile and open-operation count.
async function resolvePlanContext(target: ResolvedTarget): Promise<PlanContext> {
  const { at, date } = target.session;
  const monthlyView = filterToMonthlyExpiries(
    target.marketView ?? (await buildOperationMarketView(getDb(), target.underlying, at)),
  );
  const marketView = filterToTradedSeries(monthlyView, date);
  const chain = chainFromMonthlyView(monthlyView, date, at);
  const expiryOptions = expiryOptionsFrom(chain, date, monthlyView.calendar);

  const riskProfile = (await getCurrentRiskProfile()) ?? DEFAULT_RISK_PROFILE;
  const user = await requireUser();
  const openOperationCount = await countLiveOpenOperations(getDb(), user, at);
  const limitCentavos = riskLimitCentavos(riskProfile);

  return {
    at,
    date,
    monthlyView,
    marketView,
    chain,
    expiryOptions,
    riskProfile,
    openOperationCount,
    limitCentavos,
  };
}

// The recipe's own "N sessions before expiry" pricing dates, resolved against this expiry;
// shared by `buildPlan` and `buildEdited` so each only differs in how the leg quantities
// themselves are priced.
async function sessionsBeforeExpiryFor(
  recipe: Recipe,
  expiry: SessionDate | null,
): Promise<Map<number, SessionDate | null>> {
  const sessionsByDays = new Map<number, SessionDate | null>();
  for (const days of new Set(daysBeforeExpiryValues(recipe))) {
    if (days === 0) {
      sessionsByDays.set(0, expiry);
      continue;
    }
    if (!expiry) {
      sessionsByDays.set(days, null);
      continue;
    }
    const beforeExpiry = await nthSessionBefore(getDb(), expiry, days);
    sessionsByDays.set(days, beforeExpiry ? beforeExpiry.date : null);
  }
  return sessionsByDays;
}

interface BuiltPlan {
  target: ResolvedTarget;
  result: GeneratePlanResult;
  seriesByTicker: Map<string, PlanLegSeries>;
  riskLimitCentavos: number;
  marketView: MarketView;
  riskProfile: RiskProfile;
  openOperationCount: number;
  chain: PlanChainEntry[];
  expiryOptions: SessionDate[];
}

// One lot's two-rung pricing (generate-plan.ts's `LotPricing`), via the structure's own engine
// selection — this probe already resolves the abstract `LegSelection` into concrete legs with
// last-trade prices, so `priceFromProbe` (reprice-legs.ts) reuses it directly instead of probing
// a second time; the drag-to-adjust path (ticket #380) prices the user's own chosen legs instead,
// via `priceExactLegs`, which probes once itself.
async function priceLot(
  view: Awaited<ReturnType<typeof buildOperationMarketView>>,
  at: Instant,
  recipe: Recipe,
  structure: Structure,
  underlying: Ticker,
  lots: number,
  riskProfile: RiskProfile,
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
  return priceFromProbe(view, at, probed.value, riskProfile, openOperationCount);
}

// Builds the deterministic plan for a resolved target (ticket #379): every number is priced by
// the engine's own `priceOperation`, lot by lot (CLAUDE.md principle 1 — this module computes
// no number of its own). Recomputed from scratch on every call, including right before a save,
// so nothing persisted was ever only client-trusted. Falls back to the declared default risk
// profile (docs/adr/0075) when the user has none, the same as every other feature that needs one.
// Prices at `target.session`'s own close instant, not "now" and not merely the latest closed
// calendar session: see `resolvePricingSessionFor`. Reuses `target.marketView` when the resolve
// step already built one (the view path) instead of asking `buildOperationMarketView` a second
// time for the same underlying and instant. Beyond the monthly-expiry filter, also narrows to
// series that actually traded at that same session (`filterToTradedSeries`): the engine's own
// moneyness rule can then only pick a strike something traded that close, so a leg being
// `stale` or priceless becomes structurally unlikely rather than something caught only after
// the fact.
async function buildPlan(target: ResolvedTarget): Promise<BuiltPlan> {
  const { at, marketView, chain, expiryOptions, riskProfile, openOperationCount, limitCentavos } =
    await resolvePlanContext(target);

  // Shared between this function's own lot-1 precompute (for `seriesByTicker`/expiry) and every
  // lot count `generatePlan` prices while sizing ("share one pricing cache"): `generatePlan`
  // trusts a repeat call for the same lot count to be free, so this is the only place that
  // promise is kept.
  const cache = new Map<number, Promise<LotPricing | null>>();
  const pricingForLots = (lots: number): Promise<LotPricing | null> => {
    const cached = cache.get(lots);
    if (cached) return cached;
    const pricing = priceLot(
      marketView,
      at,
      target.recipe,
      target.structure,
      target.underlying,
      lots,
      riskProfile,
      openOperationCount,
    );
    cache.set(lots, pricing);
    return pricing;
  };

  const onePricing = await pricingForLots(1);
  const seriesByTicker = onePricing
    ? seriesFactsOf(onePricing.probe.legs, marketView.optionSeries, at)
    : new Map<string, PlanLegSeries>();
  const expiry = expiryOf(seriesByTicker);
  const sessionsByDays = await sessionsBeforeExpiryFor(target.recipe, expiry);

  const result = await generatePlan({
    recipe: target.recipe,
    structureId: target.structureId,
    structureName: target.structureName,
    underlying: target.underlying,
    view: target.view,
    ivDisplay: target.ivDisplay,
    priceSessionDate: target.session.date,
    riskLimitCentavos: limitCentavos,
    pricingForLots,
    sessionsBeforeExpiry: (businessDays) => sessionsByDays.get(businessDays) ?? null,
  });
  return {
    target,
    result,
    seriesByTicker,
    riskLimitCentavos: limitCentavos,
    marketView,
    riskProfile,
    openOperationCount,
    chain,
    expiryOptions,
  };
}

function toOutcome(built: BuiltPlan): BuildPlanOutcome {
  const { result } = built;
  if (result.ok) {
    return {
      status: "ok",
      plan: result.plan,
      seriesByTicker: Object.fromEntries(built.seriesByTicker),
      fingerprint: planFingerprint(result.plan),
      riskLimitCentavos: built.riskLimitCentavos,
      chain: built.chain,
      expiryOptions: built.expiryOptions,
      preview: {
        marketView: built.marketView,
        at: built.target.session.at,
        riskProfile: built.riskProfile,
        openOperationCount: built.openOperationCount,
      },
      structure: built.target.structure,
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

// `adjustPlanAction`'s own wire response: the same shape `toOutcome` builds, minus the market
// view, which is identical to the one `buildPlanAction` already sent for this session (same
// underlying, same pricing instant) — the client keeps its own copy and merges it back in,
// rather than this growing payload being re-shipped on every drag release, lot press or expiry
// chip.
export type AdjustPlanOutcome =
  | (Omit<Extract<BuildPlanOutcome, { status: "ok" }>, "preview"> & {
      preview: Omit<PlanPreviewContext, "marketView">;
    })
  | Extract<BuildPlanOutcome, { status: "error" }>;

function toAdjustOutcome(built: BuiltPlan): AdjustPlanOutcome {
  const outcome = toOutcome(built);
  if (outcome.status !== "ok") return outcome;
  return {
    ...outcome,
    preview: {
      at: outcome.preview.at,
      riskProfile: outcome.preview.riskProfile,
      openOperationCount: outcome.preview.openOperationCount,
    },
  };
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

// The client sends only the listed ticker per template slot (ticket #380): role, side and ratio
// always come from the structure's own template (`legsFromTemplate`), never trusted from the
// client — a client that sent its own role/side could otherwise rename a leg into one the
// structure never had.
const adjustLegInputSchema = z.strictObject({ ticker: tickerSchema });
// The drag-to-adjust screen's own edit of a plan (ticket #380): the user's chosen legs and lot
// count, optional on both `adjustPlanAction` (the live repricing round trip) and
// `savePlanAction` (absent: the user never touched a handle, saves Fetha's own plan exactly as
// `buildPlanAction` showed it, unchanged from before this ticket). Loosely bounded here (`legs`
// non-empty, `lots` a positive int); the real structural conformance check
// (`validateStructuralAdjustment`, exact leg count, role vs. listed right, one shared expiry,
// strictly increasing strikes, `lots` within `MAX_LOTS_SEARCHED`) runs server-side against the
// resolved target's own structure, since this schema alone has no structure to check against.
const adjustmentFieldsSchema = z.strictObject({
  legs: z.array(adjustLegInputSchema).min(1),
  lots: z.int().positive(),
});
export type AdjustmentFields = z.infer<typeof adjustmentFieldsSchema>;

const adjustInputSchema = z.union([
  fromViewInputSchema.extend(adjustmentFieldsSchema.shape),
  fromSuggestionInputSchema.extend(adjustmentFieldsSchema.shape),
]);
export type AdjustPlanActionInput = z.infer<typeof adjustInputSchema>;

const saveInputSchema = z.union([
  fromViewInputSchema.extend({
    fingerprint: z.string().min(1),
    adjustment: adjustmentFieldsSchema.optional(),
  }),
  fromSuggestionInputSchema.extend({
    fingerprint: z.string().min(1),
    adjustment: adjustmentFieldsSchema.optional(),
  }),
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

function expiryOfLegs(
  chain: PlanChainEntry[],
  legs: readonly { ticker: Ticker }[],
): SessionDate | null {
  const byTicker = new Map(chain.map((entry) => [entry.ticker, entry.expiry]));
  for (const leg of legs) {
    const expiry = byTicker.get(leg.ticker);
    if (expiry) return expiry;
  }
  return null;
}

const ADJUST_RATE_LIMIT = { windowSeconds: 60, max: 120 };

// The drag-to-adjust screen's own repricing (ticket #380), shared by `adjustPlanAction` (the
// live round trip on drag release, a lot +/- press or an expiry chip) and `savePlanAction`'s own
// edited branch (the save-time re-verification, same as `buildPlan` is for the unedited path):
// resolves the target exactly like `buildPlanAction` (never trusts a client-sent structure or
// recipe), then reprices the user's own chosen legs through `buildAdjustedPlan` instead of
// `generatePlan`'s auto-sizing.
async function buildEdited(
  target: ResolvedTarget,
  legs: readonly AdjustedLegInput[],
  lots: number,
): Promise<BuiltPlan> {
  const {
    at,
    date,
    monthlyView,
    marketView,
    chain,
    expiryOptions,
    riskProfile,
    openOperationCount,
    limitCentavos,
  } = await resolvePlanContext(target);

  function invalidAdjustmentOutcome(): BuiltPlan {
    return {
      target,
      result: { ok: false, reason: "invalid_adjustment" },
      seriesByTicker: new Map<string, PlanLegSeries>(),
      riskLimitCentavos: limitCentavos,
      marketView,
      riskProfile,
      openOperationCount,
      chain,
      expiryOptions,
    };
  }

  // Never trusts the client's own ticker list to already be a valid instance of this structure
  // (ticket #380): a wrong leg count, a role≠right, a mixed expiry, or equal/inverted strikes by
  // rank are refused here, before any engine pricing call, rather than priced and saved under
  // the recipe's structure anyway.
  const optionTickers = legs.map((leg) => leg.ticker);
  if (!validateStructuralAdjustment(target.structure, chain, optionTickers, lots)) {
    return invalidAdjustmentOutcome();
  }

  const expiry = expiryOfLegs(chain, legs);
  // The plan's own 20-50-session window (ticket #380): an edit (an expiry chip or a strike move
  // that lands on a different-expiry series) may never resolve to an expiry outside it, even
  // though the chips themselves are already filtered to it — the chips are a client-side
  // convenience, never the source of truth.
  if (!expiry || !isWithinPlanWindow(monthlyView.calendar, date, expiry)) {
    return invalidAdjustmentOutcome();
  }

  const sessionsByDays = await sessionsBeforeExpiryFor(target.recipe, expiry);

  const result = await buildAdjustedPlan({
    recipe: target.recipe,
    structureId: target.structureId,
    structureName: target.structureName,
    structure: target.structure,
    underlying: target.underlying,
    view: target.view,
    ivDisplay: target.ivDisplay,
    priceSessionDate: date,
    marketView,
    at,
    riskProfile,
    openOperationCount,
    legs,
    lots,
    sessionsBeforeExpiry: (businessDays) => sessionsByDays.get(businessDays) ?? null,
  });

  const seriesByTicker = result.ok
    ? seriesFactsOf(result.plan.legs, marketView.optionSeries, at)
    : new Map<string, PlanLegSeries>();

  return {
    target,
    result,
    seriesByTicker,
    riskLimitCentavos: limitCentavos,
    marketView,
    riskProfile,
    openOperationCount,
    chain,
    expiryOptions,
  };
}

// The drag-to-adjust screen's own server round trip (ticket #380): called on drag release, a
// lot +/- press or an expiry chip, never on every pixel of a drag — the client already shows a
// `priceOperation`-backed preview for that. The official numbers that replace the preview once
// this resolves.
export async function adjustPlanAction(input: unknown): Promise<AdjustPlanOutcome> {
  const parsed = adjustInputSchema.safeParse(input);
  if (!parsed.success) return { status: "error", error: "invalid" };

  return withAuthenticatedAction(async () => {
    const user = await requireUser();
    try {
      await enforceAccountRateLimit(getDb(), user.email, "plans/adjust", ADJUST_RATE_LIMIT);
    } catch (error) {
      if (error instanceof AccountRateLimitExceededError) {
        return { status: "error", error: "rate_limited" };
      }
      throw error;
    }

    const resolved = await resolveTarget(parsed.data);
    if (!resolved.ok) return { status: "error", error: resolved.reason };
    const built = await buildEdited(resolved.target, parsed.data.legs, parsed.data.lots);
    return toAdjustOutcome(built);
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

// The threshold a directional plan's auto-recorded decision is judged against: the plan's own
// break-even, not the spot it was built at — the spot a view was taken on says
// nothing about whether the position itself is still worth holding, while the break-even is the
// level this exact structure needs to clear. Falls back to spot only for a structure with no
// break-even at all.
function claimForMove(
  move: ExpectedMove,
  underlying: Ticker,
  threshold: DecimalString,
): ThesisClaim {
  switch (move) {
    case "up":
      return { kind: "close_above", instrument: underlying, level: threshold };
    case "down":
      return { kind: "close_below", instrument: underlying, level: threshold };
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

    // Fetha's own plan, always recomputed, never trusted from the client (CLAUDE.md) — the
    // source of `rules.original` (ADR-0079 addendum, ticket #380) regardless of whether the user
    // ever touched a handle. A plan the user edited away from a Fetha plan that itself did not
    // fit the risk limit has no real "original" to diff against; `originalFields` below falls
    // back to echoing the edited plan rather than inventing one.
    const autoBuilt = await buildPlan(target);
    const adjustment = parsed.data.adjustment;
    const activeBuilt = adjustment
      ? await buildEdited(target, adjustment.legs, adjustment.lots)
      : autoBuilt;

    if (!activeBuilt.result.ok) {
      const outcome = toOutcome(activeBuilt);
      return outcome.status === "error" ? outcome : { status: "error", error: "unpriceable" };
    }
    const { plan } = activeBuilt.result;

    if (planFingerprint(plan) !== parsed.data.fingerprint) {
      return { status: "error", error: "plan_changed" };
    }

    const legs: ContemplatedLeg[] = plan.legs.map(({ leg }) => ({
      role: leg.role,
      side: leg.side,
      ticker: leg.ticker,
      quantity: leg.quantity,
    }));
    const breachedLimits = plan.limitBreaches.map((breach) => breach.limit);

    const originalFields =
      autoBuilt.result.ok && autoBuilt !== activeBuilt
        ? {
            legs: autoBuilt.result.plan.legs.map(({ leg }) => ({
              role: leg.role,
              side: leg.side,
              ticker: leg.ticker,
              quantity: leg.quantity,
            })),
            lots: autoBuilt.result.plan.lots,
          }
        : { legs, lots: plan.lots };

    const rules: PlanRules = {
      recipeId: target.recipe.id,
      summary: plan.summary,
      exitRules: plan.exitRules,
      roll: plan.roll,
      original: originalFields,
    };

    const operationsRepo = new OperationsRepository(getDb(), user);
    const planRulesRepo = new PlanRulesRepository(getDb(), user);
    const decisionsRepo = new DecisionsRepository(getDb(), user);
    const expiry = expiryOf(activeBuilt.seriesByTicker);
    const horizon = planHorizon(plan, expiry);

    const operationId = await getDb().transaction(async (tx) => {
      const { id } = await operationsRepo.save(
        {
          structureId: plan.structureId,
          underlying: plan.underlying,
          legs,
          session: target.session.date,
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
            session: target.session.date,
            netPremiumCentavos: plan.netPremiumCentavos,
            maxLossCentavos: plan.maxLossCentavos === "unbounded" ? null : plan.maxLossCentavos,
            maxGainCentavos: plan.maxGainCentavos === "unbounded" ? null : plan.maxGainCentavos,
            breachedLimits,
          },
          rationale: plan.summary,
          claim: claimForMove(
            target.recipe.expectedMove,
            plan.underlying,
            plan.breakEvens[0] ?? plan.spot,
          ),
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
