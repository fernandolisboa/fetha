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

export const getMyWatchlist = cache(async (): Promise<WatchlistRow[]> => {
  const db = getDb();
  const repository = await forCurrentUser(db, WatchlistRepository);
  const items = await repository.list();
  const rows = await Promise.all(
    items.map(async (item) => {
      const [lastClose, reading] = await Promise.all([
        latestCandle(db, item.ticker),
        loadAssetReading(db, item.ticker),
      ]);
      return { ...item, lastClose, reading };
    }),
  );
  return rows;
});

export const isOnMyWatchlist = cache(async (ticker: string): Promise<boolean> => {
  const repository = await forCurrentUser(getDb(), WatchlistRepository);
  return (await repository.list()).some((item) => item.ticker === ticker);
});
