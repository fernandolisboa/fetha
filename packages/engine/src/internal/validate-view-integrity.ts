import type { EngineError, MarketView } from "../api";
import { codeUnitCompare, sortUnique } from "./order";
import { invalidInput } from "./errors";

// Deterministic settlement needs a calendar with one row per date and candles with one row
// per (ticker, timeframe, asOf): `sessionByDate`, `sessionAtOrBefore` and `latestVisible` all
// resolve "the" row for a key by array order when two rows share it exactly, which silently
// depends on caller-supplied order instead of being an error (round 1 item 11). Shared by
// markToMarket and proposeSettlement, the two callers that resolve a settlement from a view.
export function validateViewIntegrity(view: MarketView): EngineError | null {
  const calendarDupe = sortUnique(
    view.calendar,
    (s) => s.date,
    (a, b) => codeUnitCompare(a.date, b.date),
  );
  if (!calendarDupe.ok) {
    return invalidInput("view.calendar", `duplicate calendar date ${calendarDupe.duplicateKey}`);
  }

  const candleKey = (c: MarketView["candles"][number]): string =>
    `${c.ticker}|${c.timeframe}|${c.asOf}`;
  const candleDupe = sortUnique(view.candles, candleKey, (a, b) =>
    codeUnitCompare(candleKey(a), candleKey(b)),
  );
  if (!candleDupe.ok) {
    return invalidInput("view.candles", `duplicate candle for ${candleDupe.duplicateKey}`);
  }

  return null;
}
