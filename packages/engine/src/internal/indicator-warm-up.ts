import type { IndicatorSpec } from "@fetha/contracts";

// Candles a reading is computed over (ADR-0048). EMA's seed keeps (1 - 2/(L+1))^(2L) of its weight
// after 3L candles, under 2%; Wilder smoothing (RSI, ATR) decays slower, ((L-1)/L)^(n-L), and needs
// 6L to get under 1% (L = 14: 0.6%), so a reading stays close to the one a long chart series shows.
export function warmUpCandleCount(indicator: IndicatorSpec): number {
  switch (indicator.kind) {
    case "sma":
      return indicator.length;
    case "ema":
      return indicator.length * 3;
    case "rsi":
    case "atr":
      return indicator.length * 6;
    case "iv_rank":
      return 1;
  }
}
