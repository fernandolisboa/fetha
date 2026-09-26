import type { Instant, Ticker } from "@fetha/contracts";
import type { MarketView, OptionSeries } from "../api";
import { parseDecimal } from "./decimal";
import { compareInstants, isAtOrBefore } from "./instant";
import { rowsWithKey } from "./view-index";

const seriesTickerOf = (series: OptionSeries): string => series.ticker;

// Order-invariance (I3): candidates come from filtering MarketView.optionSeries, whose row
// order is not meaningful, so a tie on distance must resolve to the same series regardless of
// array order: the lower strike, then the lexicographically earlier ticker (shared with
// resolve-leg-selection.ts and implied-volatility-index.ts; PR #53 round 5 item 1).
export function isEarlierByStrikeThenTicker(a: OptionSeries, b: OptionSeries): boolean {
  const strikeCompare = parseDecimal(a.strike).cmp(parseDecimal(b.strike));
  if (strikeCompare !== 0) return strikeCompare < 0;
  return a.ticker < b.ticker;
}

// A true (ticker, asOf) duplicate (a data-integrity issue, not a re-listing: a re-listing
// always advances asOf) must still resolve to the same row regardless of array order. Break
// the tie by strike, then expiry, then right, then ticker, all numerically/lexicographically
// (PR #53 round 4 item 4, extended round 5 item 2; documented in ADR-0013's #21 addendum).
function isEarlierOnExactTie(a: OptionSeries, b: OptionSeries): boolean {
  const strikeCompare = parseDecimal(a.strike).cmp(parseDecimal(b.strike));
  if (strikeCompare !== 0) return strikeCompare < 0;
  if (a.expiry !== b.expiry) return a.expiry < b.expiry;
  if (a.right !== b.right) return a.right < b.right;
  return a.ticker < b.ticker;
}

// A ticker can be re-listed (a strike adjustment, a superseded expiry): more than one
// `optionSeries` row can share a ticker and differ only in `asOf`. Every direct lookup and
// every candidate list built from `MarketView.optionSeries` must resolve the same
// latest-visible row per ticker, or a selection can pick a different series than the one
// priced a moment later from the same view (I3, order invariance; PR #53 round 3 item 1).
export function resolveSeries(view: MarketView, ticker: Ticker, at: Instant): OptionSeries | null {
  const rows = rowsWithKey(view.optionSeries, seriesTickerOf, ticker);
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
