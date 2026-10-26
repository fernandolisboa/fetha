import {
  conditionIndicators,
  type ExpirySelection,
  type IndicatorSpec,
  type Instant,
  type Recipe,
  type RiskProfile,
  type Structure,
  type Ticker,
} from "@fetha/contracts";
import {
  engine,
  type AssetReading,
  type EngineErrorCode,
  type EvaluationOutcome,
  type IndicatorSeries,
  type MarketView,
  type OperationPricing,
} from "@fetha/engine";

import { catalog, recipes } from "@/modules/strategies";

import type { RadarFacts, RadarLeg } from "./match";
import { SUGGESTION_LOT, suggestionFrom, type SuggestionDraft } from "./suggestion";

export interface RadarMatch {
  recipeId: string;
  facts: RadarFacts;
  legs: RadarLeg[];
  suggestion: SuggestionDraft | null;
}

export type UnderlyingRead =
  { ok: true; reading: AssetReading; matches: RadarMatch[] } | { ok: false; code: EngineErrorCode };

// The outcomes ADR-0014 (Q45) records only after the entry condition held: the radar has no
// capital to size against, so `unsizeable` (no_declared_capital) is the usual one.
const conditionHeldOutcomes: ReadonlySet<EvaluationOutcome> = new Set([
  "signal",
  "unsizeable",
  "no_series_match",
  "degenerate_strikes",
]);

function specKey(spec: IndicatorSpec): string {
  return spec.kind === "iv_rank"
    ? `iv_rank:${String(spec.lookbackSessions)}`
    : `${spec.kind}:${String(spec.length)}`;
}

function entrySpecs(recipe: Recipe): IndicatorSpec[] {
  const unique = new Map(
    conditionIndicators(recipe.definition.entry).map((spec) => [specKey(spec), spec]),
  );
  return [...unique.values()];
}

function factsFor(recipe: Recipe, series: IndicatorSeries): RadarFacts | null {
  const close = series.candles.at(-1)?.close;
  if (!close) return null;
  const last = new Map(
    series.series.map((entry) => [specKey(entry.indicator), entry.values.at(-1) ?? null]),
  );
  return {
    close,
    indicators: entrySpecs(recipe).map((indicator) => ({
      indicator,
      value: last.get(specKey(indicator)) ?? null,
    })),
  };
}

function legsOf(pricing: OperationPricing, view: MarketView, at: Instant): RadarLeg[] {
  return pricing.legs.map(({ leg }) => {
    if (leg.role === "stock") {
      return { role: "stock", side: leg.side, ticker: leg.ticker, strike: null, expiry: null };
    }
    const series = view.optionSeries
      .filter((candidate) => candidate.ticker === leg.ticker && candidate.asOf <= at)
      .reduce<MarketView["optionSeries"][number] | null>(
        (latest, candidate) => (!latest || candidate.asOf > latest.asOf ? candidate : latest),
        null,
      );
    return {
      role: leg.role,
      side: leg.side,
      ticker: leg.ticker,
      strike: series?.strike ?? null,
      expiry: series?.expiry ?? null,
    };
  });
}

interface ResolvedRecipe {
  structure: Structure;
  expiry: ExpirySelection;
}

function resolveRecipe(recipe: Recipe): ResolvedRecipe | null {
  const { definition } = recipe;
  const structure = catalog.find(
    (entry) => entry.structure.id === definition.structureId,
  )?.structure;
  return structure && definition.expiry ? { structure, expiry: definition.expiry } : null;
}

export interface RecipeEvaluationInput {
  recipe: Recipe;
  view: MarketView;
  ticker: Ticker;
  at: Instant;
}

// Whether the recipe's entry condition held for `ticker` at `at`, exactly as the engine
// evaluates the recipe as a strategy; null when the book cannot resolve the recipe or the engine
// cannot evaluate it on this view.
export async function recipeEntryHeld({
  recipe,
  view,
  ticker,
  at,
}: RecipeEvaluationInput): Promise<boolean | null> {
  const resolved = resolveRecipe(recipe);
  if (!resolved) return null;
  const evaluation = await engine.evaluateStrategy({
    view,
    strategy: {
      id: `recipe:${recipe.id}`,
      definition: recipe.definition,
      structure: resolved.structure,
    },
    instruments: [ticker],
    at,
  });
  if (!evaluation.ok) return null;
  const record = evaluation.value.evaluations.findLast((entry) => entry.ticker === ticker);
  return record ? conditionHeldOutcomes.has(record.outcome) : null;
}

export interface PricedLot {
  pricing: OperationPricing;
  legs: RadarLeg[];
  suggestion: SuggestionDraft | null;
}

// One standard lot, never a position size: sizing to a capital is the user's (docs/adr/0067).
// The nightly scan passes no risk profile; the on-demand research (docs/adr/0075) passes the
// user's, so the engine reports the limits the lot breaches.
export async function priceRecipeLot({
  recipe,
  view,
  ticker,
  at,
  riskProfile,
  openOperationCount,
}: RecipeEvaluationInput & {
  riskProfile?: RiskProfile;
  openOperationCount?: number;
}): Promise<PricedLot | null> {
  const resolved = resolveRecipe(recipe);
  if (!resolved) return null;
  const pricing = await engine.priceOperation({
    view,
    at,
    legs: {
      structure: resolved.structure,
      underlying: ticker,
      strikes: recipe.definition.strikes,
      expiry: resolved.expiry,
      quantity: SUGGESTION_LOT,
    },
    ...(riskProfile ? { riskProfile } : {}),
    ...(openOperationCount === undefined ? {} : { openOperationCount }),
  });
  if (!pricing.ok) return null;
  const legs = legsOf(pricing.value, view, at);
  return { pricing: pricing.value, legs, suggestion: suggestionFrom(pricing.value, legs) };
}

async function matchRecipe(
  input: RecipeEvaluationInput,
  series: IndicatorSeries,
): Promise<RadarMatch | null> {
  if (!(await recipeEntryHeld(input))) return null;
  const lot = await priceRecipeLot(input);
  if (!lot) return null;
  const facts = factsFor(input.recipe, series);
  if (!facts) return null;
  return {
    recipeId: input.recipe.id,
    facts,
    legs: lot.legs,
    suggestion: lot.suggestion,
  };
}

// One underlying at one closed session: its asset reading and every recipe whose entry
// condition held there and whose legs resolve to listed series. Everything is the engine's.
export async function readUnderlying(
  view: MarketView,
  ticker: Ticker,
  at: Instant,
): Promise<UnderlyingRead> {
  const reading = await engine.assetReading({ view, ticker, at });
  if (!reading.ok) return { ok: false, code: reading.error.code };

  const specs = new Map(recipes.flatMap(entrySpecs).map((spec) => [specKey(spec), spec] as const));
  const series = await engine.indicators({
    view,
    ticker,
    timeframe: "D1",
    indicators: [...specs.values()],
    at,
  });
  if (!series.ok) return { ok: false, code: series.error.code };

  const matches: RadarMatch[] = [];
  for (const recipe of recipes) {
    const match = await matchRecipe({ recipe, view, ticker, at }, series.value);
    if (match) matches.push(match);
  }
  return { ok: true, reading: reading.value, matches };
}
