import type { DecimalString, Instant, Ticker } from "@fetha/contracts";
import type { MarketView } from "../api";
import { parseDecimal, PRICE_SCALE, toDecimalString } from "./decimal";
import type { ResolvedMarketPrice } from "./option-pricing";
import { latestVisible } from "./visible";

// The mid/last/close/average ladder is shared by pricing (price-operation.ts) and by
// delta-based strike selection (resolve-leg-selection.ts): both must read the same
// latest-visible price for a ticker, or a selection could resolve a different strike than
// the one that gets priced a moment later from the same view (I3, order-invariance).
export function resolveLegMarketPrice(
  view: MarketView,
  ticker: Ticker,
  at: Instant,
  given?: DecimalString,
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
  if (dayPrice?.close) return { value: dayPrice.close, source: "close", stale: null };
  if (dayPrice?.average) return { value: dayPrice.average, source: "average", stale: null };
  return null;
}
