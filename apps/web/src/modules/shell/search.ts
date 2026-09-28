export interface InstrumentSearchHit {
  ticker: string;
}

export interface StrategySearchHit {
  id: string;
  name: string;
}

export type InstrumentSearchOutcome =
  { status: "ok"; results: InstrumentSearchHit[] } | { status: "error"; error: "rate_limited" };

export type StrategySearchOutcome =
  { status: "ok"; results: StrategySearchHit[] } | { status: "error"; error: "rate_limited" };

export type InstrumentSearchFn = (input: { query: string }) => Promise<InstrumentSearchOutcome>;
export type StrategySearchFn = (input: { query: string }) => Promise<StrategySearchOutcome>;

export type MergedSearchOutcome =
  | { kind: "ok"; instruments: InstrumentSearchHit[]; strategies: StrategySearchHit[] }
  | { kind: "rate_limited" };

// One call combines the two Server Actions the layout injected (Promise.all
// in the caller); this just folds their independent outcomes into the one
// shape the palette renders from, so a rate limit on either source reads
// the same as a rate limit on both (CLAUDE.md principle 7: shell keeps no
// edge to watchlist or strategies, so it only ever sees these results, not
// the actions that produced them).
export function mergeSearchOutcomes(
  instruments: InstrumentSearchOutcome,
  strategies: StrategySearchOutcome,
): MergedSearchOutcome {
  if (instruments.status === "error" || strategies.status === "error") {
    return { kind: "rate_limited" };
  }
  return { kind: "ok", instruments: instruments.results, strategies: strategies.results };
}

export function instrumentHref(ticker: string): string {
  return `/ativos/${encodeURIComponent(ticker)}`;
}

export function strategyHref(strategyId: string): string {
  return `/estrategias/${encodeURIComponent(strategyId)}`;
}
