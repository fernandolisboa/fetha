import type { DecimalString, Instant, SessionDate, Ticker } from "@fetha/contracts";
import type { EngineError, MarketView } from "../api";
import { sessionAtOrBefore } from "./calendar";
import { parseDecimal, PRICE_SCALE, toDecimalString, toDecimalStringAtLeastScale } from "./decimal";
import type { ResolvedMarketPrice } from "./option-pricing";
import { rescaleStalePrice, visibleFactorsFor } from "./split-factor";
import {
  lastVisibleByAsOfString,
  latestSessionVersion,
  latestVisibleIndexed,
  rowsWithKey,
} from "./view-index";

type Row = { ticker: Ticker };
const tickerOf = (row: Row): string => row.ticker;
const dailyCandleTickerOf = (c: MarketView["candles"][number]): string | null =>
  c.timeframe === "D1" ? c.ticker : null;

// The spot and a stock leg's own close read one candle: two candles sharing an `asOf` once
// resolved to different rows for the two (#343).
function latestDailyCandle(
  view: MarketView,
  ticker: Ticker,
  at: Instant,
): MarketView["candles"][number] | null {
  return latestSessionVersion(
    rowsWithKey(view.candles, dailyCandleTickerOf, ticker),
    at,
    lastVisibleByAsOfString,
  );
}

// A quote carries no session of its own; the session it was taken in is what tells a quote
// carried past an ex-date from a fresh one (#343).
function quoteSession(view: MarketView, quote: { asOf: Instant }): SessionDate | null {
  return sessionAtOrBefore(view.calendar, quote.asOf)?.date ?? null;
}

function staleAgainst(
  session: SessionDate | null,
  atSession: SessionDate | null | undefined,
): { session: SessionDate } | null {
  return atSession && session !== null && session !== atSession ? { session } : null;
}

// The mid/last/close/average ladder is shared by pricing (price-operation.ts) and by
// delta-based strike selection (resolve-leg-selection.ts): both must read the same
// latest-visible price for a ticker, or a selection could resolve a different strike than
// the one that gets priced a moment later from the same view (I3, order-invariance).
//
// `atSession` is the session of `at`, when the caller has it: it is what lets every rung flag
// `stale` (ADR-0014 Q42, an untraded series marked at its last trade or a quote taken in an
// earlier session), which a caller needs to rescale or suppress a price across an ex-date.
//
// `kind` selects the day-price rung: `optionPrices` for an option leg (`OptionDayPrice`
// carries the close/average an option series trades at), the latest visible D1 candle
// close for a stock leg or a standalone `Position`, which never appear in `optionPrices`
// (on the daily tier a stock's only rung being `optionPrices` left every
// stock mark `null`, so equity was always just cash).
export function resolveLegMarketPrice(
  view: MarketView,
  ticker: Ticker,
  at: Instant,
  given?: DecimalString,
  atSession?: SessionDate | null,
  kind: "option" | "stock" = "option",
): ResolvedMarketPrice | null {
  if (given) return { value: given, source: "given", stale: null };
  const quote = latestVisibleIndexed(rowsWithKey(view.quotes, tickerOf, ticker), at);
  if (quote?.bid && quote.ask) {
    return {
      value: toDecimalString(
        parseDecimal(quote.bid).add(parseDecimal(quote.ask)).div(2),
        PRICE_SCALE,
      ),
      source: "mid",
      stale: staleAgainst(quoteSession(view, quote), atSession),
    };
  }
  if (quote?.last) {
    return {
      value: quote.last,
      source: "last",
      stale: staleAgainst(quoteSession(view, quote), atSession),
    };
  }

  if (kind === "stock") {
    const candle = latestDailyCandle(view, ticker, at);
    if (!candle) return null;
    return { value: candle.close, source: "close", stale: staleAgainst(candle.session, atSession) };
  }

  const dayPrice = latestVisibleIndexed(rowsWithKey(view.optionPrices, tickerOf, ticker), at);
  if (!dayPrice) return null;
  const stale = staleAgainst(dayPrice.session, atSession);
  if (dayPrice.close) return { value: dayPrice.close, source: "close", stale };
  if (dayPrice.average) return { value: dayPrice.average, source: "average", stale };
  return null;
}

// The underlying's own spot uses the same mid-before-last precedence as a leg's market
// price, falling back to the latest visible D1 candle close
// instead of an option series' day price, which the underlying itself never has. `session`
// names the session the candle or quote came from, so a caller can tell a spot carried forward
// across an ex-date the same way `resolveLegMarketPrice`'s `stale` does.
export function resolveUnderlyingSpotReading(
  view: MarketView,
  ticker: Ticker,
  at: Instant,
): { value: DecimalString; session: SessionDate | null } | null {
  const quote = latestVisibleIndexed(rowsWithKey(view.quotes, tickerOf, ticker), at);
  if (quote?.bid && quote.ask) {
    return {
      value: toDecimalString(
        parseDecimal(quote.bid).add(parseDecimal(quote.ask)).div(2),
        PRICE_SCALE,
      ),
      session: quoteSession(view, quote),
    };
  }
  if (quote?.last) return { value: quote.last, session: quoteSession(view, quote) };
  const candle = latestDailyCandle(view, ticker, at);
  return candle ? { value: candle.close, session: candle.session } : null;
}

export function resolveUnderlyingSpot(
  view: MarketView,
  ticker: Ticker,
  at: Instant,
): DecimalString | null {
  return resolveUnderlyingSpotReading(view, ticker, at)?.value ?? null;
}

type SpotReading = { spot: DecimalString; rescaled: boolean };

// A spot carried forward from before an ex-date sits on the pre-factor scale, while the strikes
// derived for the session of `at` and the rebased quantities sit on the post-factor one; the
// pricing model, the payoff samples, strike selection and the implied-volatility index read it
// rescaled, at full precision.
export function resolveUnderlyingSpotOnSessionScale(
  view: MarketView,
  underlying: Ticker,
  at: Instant,
): { ok: true; value: SpotReading | null } | { ok: false; error: EngineError } {
  const reading = resolveUnderlyingSpotReading(view, underlying, at);
  if (!reading) return { ok: true, value: null };
  const rescaled = rescaleStalePrice(
    visibleFactorsFor(view.corporateActions, underlying, at),
    parseDecimal(reading.value),
    reading.session,
    sessionAtOrBefore(view.calendar, at)?.date ?? null,
  );
  if (!rescaled.ok) return rescaled;
  if (!rescaled.value.rescaled)
    return { ok: true, value: { spot: reading.value, rescaled: false } };
  return {
    ok: true,
    value: {
      spot: toDecimalStringAtLeastScale(rescaled.value.price, PRICE_SCALE),
      rescaled: true,
    },
  };
}
