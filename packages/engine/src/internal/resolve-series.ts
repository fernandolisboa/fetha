import type { Instant, Ticker } from "@fetha/contracts";
import type { MarketView, OptionSeries } from "../api";
import { parseDecimal } from "./decimal";
import { compareInstants, isAtOrBefore } from "./instant";

// A true (ticker, asOf) duplicate (a data-integrity issue, not a re-listing: a re-listing
// always advances asOf) must still resolve to the same row regardless of array order. Break
// the tie by the lower strike, the same convention resolve-leg-selection.ts uses for other
// candidate ties (PR #53 round 4 item 4; documented in ADR-0013's #21 addendum).
function isEarlierOnExactTie(a: OptionSeries, b: OptionSeries): boolean {
  return parseDecimal(a.strike).lt(parseDecimal(b.strike));
}

// A ticker can be re-listed (a strike adjustment, a superseded expiry): more than one
// `optionSeries` row can share a ticker and differ only in `asOf`. Every direct lookup and
// every candidate list built from `MarketView.optionSeries` must resolve the same
// latest-visible row per ticker, or a selection can pick a different series than the one
// priced a moment later from the same view (I3, order invariance; PR #53 round 3 item 1).
export function resolveSeries(view: MarketView, ticker: Ticker, at: Instant): OptionSeries | null {
  const rows = view.optionSeries.filter((series) => series.ticker === ticker);
  let latest: OptionSeries | null = null;
  for (const row of rows) {
    if (!isAtOrBefore(row.asOf, at)) continue;
    const comparison = latest ? compareInstants(row.asOf, latest.asOf) : 1;
    if (!latest || comparison > 0 || (comparison === 0 && isEarlierOnExactTie(row, latest))) {
      latest = row;
    }
  }
  return latest;
}

export function collapseSeriesByTicker(rows: readonly OptionSeries[], at: Instant): OptionSeries[] {
  const latestByTicker = new Map<Ticker, OptionSeries>();
  for (const row of rows) {
    if (!isAtOrBefore(row.asOf, at)) continue;
    const current = latestByTicker.get(row.ticker);
    const comparison = current ? compareInstants(row.asOf, current.asOf) : 1;
    if (!current || comparison > 0 || (comparison === 0 && isEarlierOnExactTie(row, current))) {
      latestByTicker.set(row.ticker, row);
    }
  }
  return [...latestByTicker.values()];
}
