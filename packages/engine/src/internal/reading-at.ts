import type {
  DecimalString,
  IndicatorSpec,
  Instant,
  SessionDate,
  Timeframe,
} from "@fetha/contracts";
import type { Candle } from "../api";
import { earliestCandleSession, earliestIvSession, type TradingCalendar } from "./data-window";
import { parseDecimal } from "./decimal";
import { warmUpCandleCount } from "./indicator-warm-up";
import { lastRecursiveValue } from "./indicators-computation";
import type { PriceBar } from "./indicators/atr";
import { assertDefined } from "./invariant";
import { codeUnitCompare } from "./order";

const parsedBars = new WeakMap<readonly Candle[], PriceBar[]>();

function barsOf(candles: readonly Candle[]): PriceBar[] {
  let bars = parsedBars.get(candles);
  if (!bars) {
    bars = candles.map((c) => ({
      high: parseDecimal(c.high),
      low: parseDecimal(c.low),
      close: parseDecimal(c.close),
    }));
    parsedBars.set(candles, bars);
  }
  return bars;
}

// A recursive indicator is read over the trailing window dataWindow requests for it, ending at the
// evaluated candle, not over everything the view holds before it: the view starts where the
// call's `since` needs it to, so reading over all of it would seed EMA, RSI and ATR at a point
// that depends on how long the catch-up is (#239, ADR-0048). The window is bounded by calendar
// sessions, as dataWindow walks them, not by a count of the candles present: a session with no
// candle for the ticker would otherwise pull an older candle into a long view that a short view
// never loaded. A view whose calendar does not reach `windowEnd` falls back to the count. `sma` is
// bounded by the same walk but strictly (ADR-0050), and so is `iv_rank` over the sessions of the
// IV points it ranks (ADR-0051). Shared by `evaluate-strategy.ts` (one reading per instant it
// visits) and `asset-reading.ts` (one reading, at the latest instant only).
export function readingAt(
  indicator: IndicatorSpec,
  series: readonly (DecimalString | null)[],
  candles: readonly Candle[],
  position: number,
  calendar: TradingCalendar,
  timeframe: Timeframe,
  windowEnd: Instant,
  rankedIvSessions: () => readonly SessionDate[],
): DecimalString | null {
  switch (indicator.kind) {
    case "sma": {
      const earliest = earliestCandleSession(
        calendar,
        windowEnd,
        warmUpCandleCount(indicator),
        timeframe,
      );
      const first = candles[position + 1 - indicator.length];
      if (
        earliest !== null &&
        (first === undefined || codeUnitCompare(first.session, earliest) < 0)
      )
        return null;
      return assertDefined(series[position], "readingAt: missing indicator value");
    }
    case "iv_rank": {
      const earliest = earliestIvSession(calendar, windowEnd, indicator.lookbackSessions);
      const sessions = rankedIvSessions();
      const first = sessions[sessions.length - indicator.lookbackSessions];
      if (earliest !== null && (first === undefined || codeUnitCompare(first, earliest) < 0))
        return null;
      return assertDefined(series[position], "readingAt: missing indicator value");
    }
    case "ema":
    case "rsi":
    case "atr": {
      const needed = warmUpCandleCount(indicator);
      const earliest = earliestCandleSession(calendar, windowEnd, needed, timeframe);
      let start = earliest === null ? Math.max(0, position + 1 - needed) : position;
      while (
        earliest !== null &&
        start > 0 &&
        codeUnitCompare(
          assertDefined(candles[start - 1], "readingAt: missing candle").session,
          earliest,
        ) >= 0
      ) {
        start -= 1;
      }
      return lastRecursiveValue(
        indicator.kind,
        indicator.length,
        barsOf(candles).slice(start, position + 1),
      );
    }
  }
}
