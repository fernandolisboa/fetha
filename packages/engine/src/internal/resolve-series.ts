import type { Instant, Ticker } from "@fetha/contracts";
import type { MarketView, OptionSeries } from "../api";
import { compareInstants, isAtOrBefore } from "./instant";
import { latestVisible } from "./visible";

// A ticker can be re-listed (a strike adjustment, a superseded expiry): more than one
// `optionSeries` row can share a ticker and differ only in `asOf`. Every direct lookup and
// every candidate list built from `MarketView.optionSeries` must resolve the same
// latest-visible row per ticker, or a selection can pick a different series than the one
// priced a moment later from the same view (I3, order invariance; PR #53 round 3 item 1).
export function resolveSeries(view: MarketView, ticker: Ticker, at: Instant): OptionSeries | null {
  return latestVisible(
    view.optionSeries.filter((series) => series.ticker === ticker),
    at,
  );
}

export function collapseSeriesByTicker(rows: readonly OptionSeries[], at: Instant): OptionSeries[] {
  const latestByTicker = new Map<Ticker, OptionSeries>();
  for (const row of rows) {
    if (!isAtOrBefore(row.asOf, at)) continue;
    const current = latestByTicker.get(row.ticker);
    if (!current || compareInstants(row.asOf, current.asOf) > 0)
      latestByTicker.set(row.ticker, row);
  }
  return [...latestByTicker.values()];
}
