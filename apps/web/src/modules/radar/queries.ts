import { cache } from "react";

import { getDb } from "@/db/client";
import { forCurrentUser } from "@/modules/auth";
import { countSessionsClosedAfter } from "@/modules/market-data";
import { WatchlistRepository } from "@/modules/watchlist";

import { suggestionCalibration, type SuggestionCalibration } from "./calibration";
import { latestRadar, newestReadSession } from "./radar-repository";
import { radarView, type RadarView } from "./radar-view";
import { suggestionView, type SuggestionView } from "./suggestion-view";
import { suggestionValidity } from "./suggestion-validity";
import { todaySuggestions, type TodaySuggestionsResult } from "./today-suggestions";
import { findSuggestion, latestSuggestions, scoredSuggestions } from "./suggestions-repository";

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
  const db = getDb();
  const [stored, newest] = await Promise.all([findSuggestion(db, id), newestReadSession(db)]);
  const view = stored ? suggestionView(stored, suggestionValidity(stored.session, newest)) : null;
  if (!view) throw new SuggestionNotFoundError();
  return view;
});

// docs/adr/0073: the nightly runs read a close overnight, the last attempt at 09:00 UTC the next
// morning, so a close is overdue only once it has gone unread for longer than that.
const OVERDUE_AFTER_CLOSE_MS = 18 * 60 * 60 * 1000;

// Today's suggestions (docs/adr/0073): the radar's newest read session, however old, with how
// many later closes the radar is overdue on.
export const getTodaySuggestions = cache(async (): Promise<TodaySuggestionsResult> => {
  const db = getDb();
  const stored = await latestSuggestions(db);
  const [first] = stored;
  if (!first) return { kind: "none" };
  const overdueSessions = await countSessionsClosedAfter(
    db,
    first.session,
    new Date(Date.now() - OVERDUE_AFTER_CLOSE_MS),
  );
  const current = { archived: false } as const;
  return todaySuggestions(
    first.session,
    overdueSessions,
    stored.flatMap((row) => suggestionView(row, current) ?? []),
  );
});

// Shared reference data like the suggestions themselves: the same calibration for every user.
export const getSuggestionCalibration = cache(async (): Promise<SuggestionCalibration> =>
  suggestionCalibration(await scoredSuggestions(getDb())),
);
