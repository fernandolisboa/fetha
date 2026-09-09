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

// None of the methods behind these six vocabularies is implemented yet (issue #14
// landed only capabilities/dataWindow/indicators), so every kind is unsupported for
// now. Each array must enumerate its contracts union in full: the conformance test
// checks it against the type, and dropping a member here without dropping it from the
// union is a compile error, not a silent gap.
export const unsupportedStrikeSelectionKinds = [
  "delta",
  "moneyness",
  "nearest",
] as const satisfies readonly StrikeSelection["kind"][];

export const unsupportedExpirySelectionKinds = [
  "business_days",
] as const satisfies readonly ExpirySelection["kind"][];

export const unsupportedSizingRuleKinds = [
  "fixed_fractional",
  "fixed_risk",
] as const satisfies readonly SizingRule["kind"][];

export const unsupportedExitRuleKinds = [
  "profit_target",
  "stop_loss",
  "days_before_expiry",
  "condition",
] as const satisfies readonly ExitRule["kind"][];

export const unsupportedAdjustmentRuleKinds = [
  "roll",
] as const satisfies readonly AdjustmentRule["kind"][];

export const unsupportedThesisClaimKinds = [
  "close_above",
  "close_below",
  "operation_pnl_positive",
] as const satisfies readonly ThesisClaim["kind"][];
