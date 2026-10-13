import { cache } from "react";

import { getDb } from "@/db/client";
import { forCurrentUser } from "@/modules/auth";
import { WatchlistRepository } from "@/modules/watchlist";

import { latestRadar } from "./radar-repository";
import { radarView, type RadarView } from "./radar-view";

// The latest radar for the signed-in user: the shared readings and matches, plus whether each
// matched underlying is already on this user's watchlist.
export const getRadar = cache(async (): Promise<RadarView | null> => {
  const db = getDb();
  const [radar, watchlist] = await Promise.all([
    latestRadar(db),
    forCurrentUser(db, WatchlistRepository).then((repository) => repository.list()),
  ]);
  if (!radar) return null;
  return radarView(radar, new Set(watchlist.map((item) => item.ticker)));
});
