import {
  conditionIndicators,
  type IndicatorSpec,
  type Instant,
  type Recipe,
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

async function matchRecipe(
  recipe: Recipe,
  view: MarketView,
  ticker: Ticker,
  at: Instant,
  series: IndicatorSeries,
): Promise<RadarMatch | null> {
  const { definition } = recipe;
  const structure = catalog.find(
    (entry) => entry.structure.id === definition.structureId,
  )?.structure;
  if (!structure || !definition.expiry) return null;

  const evaluation = await engine.evaluateStrategy({
    view,
    strategy: { id: `recipe:${recipe.id}`, definition, structure },
    instruments: [ticker],
    at,
  });
  if (!evaluation.ok) return null;
  const record = evaluation.value.evaluations.findLast((entry) => entry.ticker === ticker);
  if (!record || !conditionHeldOutcomes.has(record.outcome)) return null;

  // One standard lot, never a position size: sizing to a capital is the user's (docs/adr/0067).
  const pricing = await engine.priceOperation({
    view,
    at,
    legs: {
      structure,
      underlying: ticker,
      strikes: definition.strikes,
      expiry: definition.expiry,
      quantity: SUGGESTION_LOT,
    },
  });
  if (!pricing.ok) return null;

  const facts = factsFor(recipe, series);
  if (!facts) return null;
  const legs = legsOf(pricing.value, view, at);
  return { recipeId: recipe.id, facts, legs, suggestion: suggestionFrom(pricing.value, legs) };
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
    const match = await matchRecipe(recipe, view, ticker, at, series.value);
    if (match) matches.push(match);
  }
  return { ok: true, reading: reading.value, matches };
}
