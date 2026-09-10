import { cache } from "react";
import type { Ticker } from "@fetha/contracts";
import type { CandleForm, IndicatorSeries, Result } from "@fetha/engine";

import { getDb } from "@/db/client";
import { forCurrentUser } from "@/modules/auth";
import { latestCandle, loadCandleSeries, type CandleRow } from "@/modules/market-data";

import { WatchlistRepository, type WatchlistItem } from "./watchlist-repository";

export interface WatchlistRow extends WatchlistItem {
  lastClose: CandleRow | null;
}

export const getMyWatchlist = cache(async (): Promise<WatchlistRow[]> => {
  const db = getDb();
  const repository = await forCurrentUser(db, WatchlistRepository);
  const items = await repository.list();
  const rows = await Promise.all(
    items.map(async (item) => ({ ...item, lastClose: await latestCandle(db, item.ticker) })),
  );
  return rows;
});

export const getInstrumentLastClose = cache(async (ticker: Ticker): Promise<CandleRow | null> => {
  return latestCandle(getDb(), ticker);
});

export const getInstrumentSeries = cache(
  async (ticker: Ticker, form: CandleForm): Promise<Result<IndicatorSeries>> => {
    return loadCandleSeries(getDb(), ticker, form);
  },
);
