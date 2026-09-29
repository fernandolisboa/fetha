import type { IndicatorSpec } from "@fetha/contracts";

const RECURSIVE_WARMUP_MULTIPLIER = 3;

export function warmUpCandleCount(indicator: IndicatorSpec): number {
  switch (indicator.kind) {
    case "sma":
      return indicator.length;
    case "ema":
    case "rsi":
    case "atr":
      return indicator.length * RECURSIVE_WARMUP_MULTIPLIER;
    case "iv_rank":
      return 1;
  }
}
