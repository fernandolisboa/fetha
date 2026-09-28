// Every outcome `evaluate-signals.ts` records itself, outside any
// `EvaluationRecord` the engine ever produced (#133, follow-up from #80):
// this strategy version's own structure is gone from the catalog, the
// engine returned an error the caller never asked for, a catch-up range
// was clamped before it could run in full, `dataWindow()` asked for a
// collection `market-data` cannot fill for this strategy at all, or
// `loadMarketView` itself threw (a chain too large to load in one call, or
// no market data at all for the window — the same two conditions
// `apps/web/src/modules/backtests/strings.ts`'s `webErrors` already names
// for a backtest run). `entry_past_inbox_horizon` is the one code written
// over an engine record rather than instead of one: the entry was evaluated,
// but its session is older than the inbox horizon (docs/adr/0044). Each is a
// closed code of its own, not a suffix
// glued onto a shared string, so the evaluation log can render every one
// of them through a typed formatter instead of `strings.ts`'s old
// exact-sentence `detailFor` match.
export const webEvaluationReasons = [
  "unknown_structure",
  "engine_error",
  "catchup_clamped",
  "unsatisfiable_collection",
  "market_view_too_large",
  "no_market_data",
  "entry_past_inbox_horizon",
] as const;

export type WebEvaluationReason = (typeof webEvaluationReasons)[number];

export function isWebEvaluationReason(value: string): value is WebEvaluationReason {
  return (webEvaluationReasons as readonly string[]).includes(value);
}
