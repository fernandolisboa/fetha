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

// #15 implemented evaluateStrategy for stock-only strategies; #23 extends it to
// structures with option legs by delegating strike/expiry selection and pricing to
// priceOperation's own internals. Both sizing rules apply to any leg mix
// (fixed_fractional and fixed_risk, the latter unsizeable on any short leg's unbounded
// max loss), so nothing is left unsupported there.
export const implementedSizingRuleKinds = [
  "fixed_fractional",
  "fixed_risk",
] as const satisfies readonly SizingRule["kind"][];

export const unsupportedSizingRuleKinds = [] as const satisfies readonly SizingRule["kind"][];

// days_before_expiry needed an expiry, which #15's stock-only scope's coherence check
// forbade outright; #23 lifts that scope, so it is implemented for every structure with
// option legs, the only kind of structure that can carry it.
export const implementedExitRuleKinds = [
  "profit_target",
  "stop_loss",
  "condition",
  "days_before_expiry",
] as const satisfies readonly ExitRule["kind"][];

export const unsupportedExitRuleKinds = [] as const satisfies readonly ExitRule["kind"][];

// roll (a strike/expiry adjustment mid-operation) is out of #23's scope: it needs its own
// settlement-and-reopen semantics in runBacktest, tracked separately.
export const unsupportedAdjustmentRuleKinds = [
  "roll",
] as const satisfies readonly AdjustmentRule["kind"][];

export const unsupportedThesisClaimKinds = [
  "close_above",
  "close_below",
  "operation_pnl_positive",
] as const satisfies readonly ThesisClaim["kind"][];
