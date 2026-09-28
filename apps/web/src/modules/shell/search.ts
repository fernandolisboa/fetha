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
  | {
      kind: "ok";
      instruments: InstrumentSearchHit[];
      strategies: StrategySearchHit[];
      throttled: boolean;
    }
  | { kind: "rate_limited" };

export function mergeSearchOutcomes(
  instruments: InstrumentSearchOutcome,
  strategies: StrategySearchOutcome,
): MergedSearchOutcome {
  if (instruments.status === "error" && strategies.status === "error") {
    return { kind: "rate_limited" };
  }
  return {
    kind: "ok",
    instruments: instruments.status === "ok" ? instruments.results : [],
    strategies: strategies.status === "ok" ? strategies.results : [],
    throttled: instruments.status === "error" || strategies.status === "error",
  };
}

export function instrumentHref(ticker: string): string {
  return `/ativos/${encodeURIComponent(ticker)}`;
}

export function strategyHref(strategyId: string): string {
  return `/estrategias/${encodeURIComponent(strategyId)}`;
}
