import type { Instant, Ticker } from "@fetha/contracts";
import type { MarketView } from "@fetha/engine";

import type { Database } from "@/db/client";

import { buildOperationMarketView, emptyMarketView } from "./market-view";

function uniqueBy<T>(rows: readonly T[], keyOf: (row: T) => string): T[] {
  const byKey = new Map<string, T>();
  for (const row of rows) {
    if (!byKey.has(keyOf(row))) {
      byKey.set(keyOf(row), row);
    }
  }
  return [...byKey.values()];
}

// Every collection is deduplicated on the key the engine's own
// `validateViewIntegrity` rejects duplicates on: two underlyings' views share
// the calendar and the CDI row, and a stock held outright can also be
// another view's extra instrument.
export function mergeMarketViews(views: readonly MarketView[]): MarketView {
  const merged = emptyMarketView();
  const dataVersions: string[] = [];
  for (const view of views) {
    merged.calendar.push(...view.calendar);
    merged.candles.push(...view.candles);
    merged.corporateActions.push(...view.corporateActions);
    merged.optionSeries.push(...view.optionSeries);
    merged.optionPrices.push(...view.optionPrices);
    merged.macro.push(...view.macro);
    if (view.dataVersion) {
      dataVersions.push(view.dataVersion);
    }
  }
  const dataVersion = dataVersions.sort().at(-1);
  return {
    ...merged,
    calendar: uniqueBy(merged.calendar, (row) => row.date).sort((a, b) =>
      a.date.localeCompare(b.date),
    ),
    candles: uniqueBy(merged.candles, (row) => `${row.ticker}|${row.timeframe}|${row.asOf}`),
    corporateActions: uniqueBy(
      merged.corporateActions,
      (row) => `${row.ticker}|${row.exDate}|${row.asOf}`,
    ),
    optionSeries: uniqueBy(
      merged.optionSeries,
      (row) => `${row.ticker}|${row.expiry}|${row.strike}|${row.asOf}`,
    ),
    optionPrices: uniqueBy(merged.optionPrices, (row) => `${row.ticker}|${row.asOf}`),
    macro: uniqueBy(merged.macro, (row) => `${row.series}|${row.date}`),
    ...(dataVersion ? { dataVersion } : {}),
  };
}

export async function buildPortfolioMarketView(
  db: Database,
  underlyings: readonly Ticker[],
  at: Instant,
): Promise<MarketView> {
  const distinct = [...new Set(underlyings)].sort();
  const views = await Promise.all(
    distinct.map((underlying) => buildOperationMarketView(db, underlying, at)),
  );
  return mergeMarketViews(views);
}
