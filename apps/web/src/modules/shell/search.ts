import { sessionDateSchema, type DecimalString, type OptionRight } from "@fetha/contracts";

import { formatPriceBRL } from "@/lib/format/brl";
import { formatDate } from "@/lib/format/date-time";
import { sessionDateToDisplayDate } from "@/modules/market-data/client";

import { t } from "./strings";

export interface InstrumentSearchHit {
  ticker: string;
}

export interface OptionSeriesSearchHit {
  ticker: string;
  underlying: string;
  right: OptionRight;
  strike: DecimalString;
  expiry: string;
}

export interface StrategySearchHit {
  id: string;
  name: string;
}

type SearchOutcome<Hit> =
  { status: "ok"; results: Hit[] } | { status: "error"; error: "rate_limited" };

export type InstrumentSearchOutcome = SearchOutcome<InstrumentSearchHit>;
export type OptionSeriesSearchOutcome = SearchOutcome<OptionSeriesSearchHit>;
export type StrategySearchOutcome = SearchOutcome<StrategySearchHit>;

export type InstrumentSearchFn = (input: { query: string }) => Promise<InstrumentSearchOutcome>;
export type OptionSeriesSearchFn = (input: { query: string }) => Promise<OptionSeriesSearchOutcome>;
export type StrategySearchFn = (input: { query: string }) => Promise<StrategySearchOutcome>;

export interface SearchSources {
  instruments: InstrumentSearchFn;
  optionSeries: OptionSeriesSearchFn;
  strategies: StrategySearchFn;
}

export interface SearchOutcomes {
  instruments: InstrumentSearchOutcome;
  optionSeries: OptionSeriesSearchOutcome;
  strategies: StrategySearchOutcome;
}

export type MergedSearchOutcome =
  | {
      kind: "ok";
      instruments: InstrumentSearchHit[];
      optionSeries: OptionSeriesSearchHit[];
      strategies: StrategySearchHit[];
      throttled: boolean;
    }
  | { kind: "rate_limited" };

function resultsOf<Hit>(outcome: SearchOutcome<Hit>): Hit[] {
  return outcome.status === "ok" ? outcome.results : [];
}

export function mergeSearchOutcomes(outcomes: SearchOutcomes): MergedSearchOutcome {
  const statuses = [outcomes.instruments, outcomes.optionSeries, outcomes.strategies].map(
    (outcome) => outcome.status,
  );
  if (statuses.every((status) => status === "error")) {
    return { kind: "rate_limited" };
  }
  return {
    kind: "ok",
    instruments: resultsOf(outcomes.instruments),
    optionSeries: resultsOf(outcomes.optionSeries),
    strategies: resultsOf(outcomes.strategies),
    throttled: statuses.includes("error"),
  };
}

export function instrumentHref(ticker: string): string {
  return `/ativos/${encodeURIComponent(ticker)}`;
}

export function optionSeriesHref(ticker: string): string {
  return `/opcoes/${encodeURIComponent(ticker)}`;
}

export function strategyHref(strategyId: string): string {
  return `/estrategias/${encodeURIComponent(strategyId)}`;
}

// The palette row's second line: enough to tell two series of the same
// underlying apart without opening them ("PETR4 · Call · R$ 40,00 · 16/10/2026").
export function optionSeriesSummary(hit: OptionSeriesSearchHit): string {
  const expiry = formatDate(sessionDateToDisplayDate(sessionDateSchema.parse(hit.expiry)));
  return [hit.underlying, t.search.optionRight[hit.right], formatPriceBRL(hit.strike), expiry].join(
    " · ",
  );
}
