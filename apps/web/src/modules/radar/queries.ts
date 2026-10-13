import { cache } from "react";

import { getDb } from "@/db/client";
import { forCurrentUser } from "@/modules/auth";
import { WatchlistRepository } from "@/modules/watchlist";

import { latestRadar } from "./radar-repository";
import { radarView, type RadarView } from "./radar-view";
import { suggestionView, type SuggestionView } from "./suggestion-view";
import { findSuggestion, latestSuggestions } from "./suggestions-repository";

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

export class SuggestionNotFoundError extends Error {
  constructor() {
    super("Suggestion not found");
    this.name = "SuggestionNotFoundError";
  }
}

// Suggestions are shared reference data (docs/adr/0067): any signed-in user reads any of them.
export const getSuggestion = cache(async (id: string): Promise<SuggestionView> => {
  const stored = await findSuggestion(getDb(), id);
  const view = stored ? suggestionView(stored) : null;
  if (!view) throw new SuggestionNotFoundError();
  return view;
});

// Today's suggestions, the radar's newest read session, ordered like the radar's rows: by how
// many option series traded at the close, never by a score.
export const getTodaySuggestions = cache(async (): Promise<SuggestionView[]> => {
  const stored = await latestSuggestions(getDb());
  return stored
    .flatMap((row) => suggestionView(row) ?? [])
    .sort(
      (a, b) =>
        (b.reading?.options.tradedSeries ?? 0) - (a.reading?.options.tradedSeries ?? 0) ||
        a.underlying.localeCompare(b.underlying) ||
        a.recipeId.localeCompare(b.recipeId),
    );
});
