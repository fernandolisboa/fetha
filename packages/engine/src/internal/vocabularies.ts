import type {
  AdjustmentRule,
  ExitRule,
  ExpirySelection,
  IndicatorSpec,
  SizingRule,
  StrikeSelection,
  ThesisClaim,
  Timeframe,
} from "@fetha/contracts";

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

// #21 implements priceOperation's strike and expiry selection in full: delta (nearest
// |delta| at `at`), moneyness (relative to spot) and nearest (nearest listed strike to a
// given price); the one expiry-selection kind, business_days.
export const implementedStrikeSelectionKinds = [
  "delta",
  "moneyness",
  "nearest",
] as const satisfies readonly StrikeSelection["kind"][];

export const unsupportedStrikeSelectionKinds =
  [] as const satisfies readonly StrikeSelection["kind"][];

export const implementedExpirySelectionKinds = [
  "business_days",
] as const satisfies readonly ExpirySelection["kind"][];

export const unsupportedExpirySelectionKinds =
  [] as const satisfies readonly ExpirySelection["kind"][];

// #15 implements evaluateStrategy for stock-only strategies: both sizing rules apply
// to a stock leg (fixed_fractional and fixed_risk, the latter unsizeable on a short
// leg's unbounded max loss), so nothing is left unsupported there. Of the exit rules,
// only days_before_expiry stays unsupported: it needs an expiry, which a stock-only
// structure's coherence check already forbids.
export const implementedSizingRuleKinds = [
  "fixed_fractional",
  "fixed_risk",
] as const satisfies readonly SizingRule["kind"][];

export const unsupportedSizingRuleKinds = [] as const satisfies readonly SizingRule["kind"][];

export const implementedExitRuleKinds = [
  "profit_target",
  "stop_loss",
  "condition",
] as const satisfies readonly ExitRule["kind"][];

export const unsupportedExitRuleKinds = [
  "days_before_expiry",
] as const satisfies readonly ExitRule["kind"][];

// roll only makes sense on a structure with option legs (#23); a stock-only
// structure's coherence check rejects it outright.
export const unsupportedAdjustmentRuleKinds = [
  "roll",
] as const satisfies readonly AdjustmentRule["kind"][];

export const unsupportedThesisClaimKinds = [
  "close_above",
  "close_below",
  "operation_pnl_positive",
] as const satisfies readonly ThesisClaim["kind"][];
