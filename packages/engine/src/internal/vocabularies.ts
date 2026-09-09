import type { IndicatorSpec, Timeframe } from "@fetha/contracts";

// The engine may only import contracts vocabularies as types (ADR-0013), so the
// implemented subset is declared here and checked against the contracts type with
// `satisfies` rather than imported as a runtime value.
export const implementedIndicatorKinds = [
  "sma",
  "ema",
  "rsi",
  "atr",
  "iv_rank",
] as const satisfies readonly IndicatorSpec["kind"][];

export const implementedTimeframes = [
  "15m",
  "30m",
  "60m",
  "D1",
] as const satisfies readonly Timeframe[];
