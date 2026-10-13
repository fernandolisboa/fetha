import { cache } from "react";
import type { AssetReading } from "@fetha/engine";

import { getDb } from "@/db/client";
import { forCurrentUser } from "@/modules/auth";
import { latestCandle, loadAssetReading, type CandleRow } from "@/modules/market-data";

import { WatchlistRepository, type WatchlistItem } from "./watchlist-repository";

export interface WatchlistRow extends WatchlistItem {
  lastClose: CandleRow | null;
  reading: AssetReading | null;
}

// Each reading costs a handful of queries, so rows are read a few at a time rather than all at
// once: a full watchlist (100 tickers) must not open hundreds of queries in one render.
const READING_BATCH = 8;

export const getMyWatchlist = cache(async (): Promise<WatchlistRow[]> => {
  const db = getDb();
  const repository = await forCurrentUser(db, WatchlistRepository);
  const items = await repository.list();
  const rows: WatchlistRow[] = [];
  for (let start = 0; start < items.length; start += READING_BATCH) {
    const batch = items.slice(start, start + READING_BATCH);
    rows.push(
      ...(await Promise.all(
        batch.map(async (item) => {
          const [lastClose, reading] = await Promise.all([
            latestCandle(db, item.ticker),
            loadAssetReading(db, item.ticker),
          ]);
          return { ...item, lastClose, reading };
        }),
      )),
    );
  }
  return rows;
});

export const isOnMyWatchlist = cache(async (ticker: string): Promise<boolean> => {
  const repository = await forCurrentUser(getDb(), WatchlistRepository);
  return (await repository.list()).some((item) => item.ticker === ticker);
});
