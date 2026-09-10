import type { DecimalString, Instant, SessionDate, Ticker } from "@fetha/contracts";
import type { MarketView } from "../api";
import { parseDecimal, PRICE_SCALE, toDecimalString } from "./decimal";
import { isAtOrBefore } from "./instant";
import type { ResolvedMarketPrice } from "./option-pricing";
import { latestVisible } from "./visible";

// The mid/last/close/average ladder is shared by pricing (price-operation.ts) and by
// delta-based strike selection (resolve-leg-selection.ts): both must read the same
// latest-visible price for a ticker, or a selection could resolve a different strike than
// the one that gets priced a moment later from the same view (I3, order-invariance).
//
// `atSession` is the session of `at`, when the caller has it: it is what lets the
// close/average branch flag `stale` (ADR-0014 Q42, an untraded series marked at its last
// trade). Callers that only need a price for computation, not to report staleness on a
// `LegValuation` (delta selection, the implied-volatility index), omit it.
export function resolveLegMarketPrice(
  view: MarketView,
  ticker: Ticker,
  at: Instant,
  given?: DecimalString,
  atSession?: SessionDate | null,
): ResolvedMarketPrice | null {
  if (given) return { value: given, source: "given", stale: null };
  const quote = latestVisible(
    view.quotes.filter((q) => q.ticker === ticker),
    at,
  );
  if (quote?.bid && quote.ask) {
    return {
      value: toDecimalString(
        parseDecimal(quote.bid).add(parseDecimal(quote.ask)).div(2),
        PRICE_SCALE,
      ),
      source: "mid",
      stale: null,
    };
  }
  if (quote?.last) return { value: quote.last, source: "last", stale: null };
  const dayPrice = latestVisible(
    view.optionPrices.filter((p) => p.ticker === ticker),
    at,
  );
  if (!dayPrice) return null;
  const stale = atSession && dayPrice.session !== atSession ? { session: dayPrice.session } : null;
  if (dayPrice.close) return { value: dayPrice.close, source: "close", stale };
  if (dayPrice.average) return { value: dayPrice.average, source: "average", stale };
  return null;
}

// The underlying's own spot uses the same mid-before-last precedence as a leg's market
// price (item 18, PR #53 round 1), falling back to the latest visible D1 candle close
// instead of an option series' day price, which the underlying itself never has. Shared
// by price-operation.ts and the implied-volatility index (PR #53 round 3 item 9).
export function resolveUnderlyingSpot(
  view: MarketView,
  ticker: Ticker,
  at: Instant,
): DecimalString | null {
  const quote = latestVisible(
    view.quotes.filter((q) => q.ticker === ticker),
    at,
  );
  if (quote?.bid && quote.ask) {
    return toDecimalString(
      parseDecimal(quote.bid).add(parseDecimal(quote.ask)).div(2),
      PRICE_SCALE,
    );
  }
  if (quote?.last) return quote.last;
  const candle = view.candles
    .filter((c) => c.ticker === ticker && c.timeframe === "D1" && isAtOrBefore(c.asOf, at))
    .sort((a, b) => (a.asOf < b.asOf ? -1 : a.asOf > b.asOf ? 1 : 0))
    .at(-1);
  return candle?.close ?? null;
}
