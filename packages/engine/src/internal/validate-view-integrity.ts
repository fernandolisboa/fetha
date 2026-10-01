import type { CorporateActionFactor, EngineError, MarketView, TradingSession } from "../api";
import { duplicateCalendarDate } from "./calendar";
import { codeUnitCompare, sortUnique } from "./order";
import { invalidInput } from "./errors";

// Deterministic settlement needs a calendar with one row per date and candles with one row
// per (ticker, timeframe, asOf): `sessionByDate`, `sessionAtOrBefore` and `latestVisible` all
// resolve "the" row for a key by array order when two rows share it exactly, which silently
// depends on caller-supplied order instead of being an error. Shared by
// markToMarket and proposeSettlement, the two callers that resolve a settlement from a view.
export function calendarIntegrityError(calendar: readonly TradingSession[]): EngineError | null {
  const duplicate = duplicateCalendarDate(calendar);
  return duplicate === null
    ? null
    : invalidInput("view.calendar", `duplicate calendar date ${duplicate}`);
}

// A duplicated (ticker, exDate) corporate-action row is a data-integrity error, not two
// observations to reconcile: ADR-0013's ordering constraints and the database's own
// `primaryKey(ticker, exDate)` already say one event, one row. Every quantity path
// (`splitFactorProduct`) multiplies every visible factor unconditionally, so a silent collapse
// in one place (the strike path) and a silent double-application in every other would disagree on
// the same input. Rejected outright instead. The same key `buildCandleSeries`
// (candle-series.ts) checks.
export function corporateActionIntegrityError(
  corporateActions: readonly CorporateActionFactor[],
): EngineError | null {
  const key = (f: CorporateActionFactor): string => `${f.ticker}|${f.exDate}`;
  const dupe = sortUnique(corporateActions, key, (a, b) => codeUnitCompare(key(a), key(b)));
  return dupe.ok
    ? null
    : invalidInput("view.corporateActions", `duplicate corporate action for ${dupe.duplicateKey}`);
}

export function validateViewIntegrity(view: MarketView): EngineError | null {
  const calendarError = calendarIntegrityError(view.calendar);
  if (calendarError) return calendarError;

  const corporateActionError = corporateActionIntegrityError(view.corporateActions);
  if (corporateActionError) return corporateActionError;

  const candleKey = (c: MarketView["candles"][number]): string =>
    `${c.ticker}|${c.timeframe}|${c.asOf}`;
  const candleDupe = sortUnique(view.candles, candleKey, (a, b) =>
    codeUnitCompare(candleKey(a), candleKey(b)),
  );
  if (!candleDupe.ok) {
    return invalidInput("view.candles", `duplicate candle for ${candleDupe.duplicateKey}`);
  }

  // Same tie-by-array-order hazard as candles above, for `resolveLegMarketPrice`'s own
  // `optionPrices` rung: `latestVisible` resolves "the" row for a
  // (ticker, asOf) pair by array order otherwise.
  const optionPriceKey = (p: MarketView["optionPrices"][number]): string => `${p.ticker}|${p.asOf}`;
  const optionPriceDupe = sortUnique(view.optionPrices, optionPriceKey, (a, b) =>
    codeUnitCompare(optionPriceKey(a), optionPriceKey(b)),
  );
  if (!optionPriceDupe.ok) {
    return invalidInput(
      "view.optionPrices",
      `duplicate option day price for ${optionPriceDupe.duplicateKey}`,
    );
  }

  return null;
}
