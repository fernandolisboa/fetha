import { cache } from "react";
import type { SessionDate } from "@fetha/contracts";

import { getDb, type Database } from "@/db/client";
import { todaySaoPauloDate } from "@/lib/today-sao-paulo";
import { forCurrentUser, readE2EToday } from "@/modules/auth";
import { nthTradingSessionAfter } from "@/modules/market-data";
import { WatchlistRepository } from "@/modules/watchlist";

import { suggestionCalibration, type SuggestionCalibration } from "./calibration";
import { latestRadar } from "./radar-repository";
import { radarView, type RadarView } from "./radar-view";
import { suggestionView, type SuggestionView } from "./suggestion-view";
import { suggestionValidity, type SuggestionValidity } from "./suggestion-validity";
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
  const stored = await findSuggestion(db, id);
  const view = stored ? suggestionView(stored, await validityFor(db, stored.session)) : null;
  if (!view) throw new SuggestionNotFoundError();
  return view;
});

function suggestionToday(): SessionDate {
  return readE2EToday() ?? todaySaoPauloDate();
}

async function validityFor(db: Database, session: SessionDate): Promise<SuggestionValidity> {
  const next = await nthTradingSessionAfter(db, session, 1);
  return suggestionValidity(session, next?.date, suggestionToday());
}

// Today's suggestions (docs/adr/0072): the radar's newest read session, while its suggestions
// are open.
export const getTodaySuggestions = cache(async (): Promise<TodaySuggestionsResult> => {
  const db = getDb();
  const stored = await latestSuggestions(db);
  const [first] = stored;
  if (!first) return { kind: "none" };
  const validity = await validityFor(db, first.session);
  return todaySuggestions(
    first.session,
    validity,
    stored.flatMap((row) => suggestionView(row, validity) ?? []),
  );
});

// Shared reference data like the suggestions themselves: the same calibration for every user.
export const getSuggestionCalibration = cache(async (): Promise<SuggestionCalibration> =>
  suggestionCalibration(await scoredSuggestions(getDb())),
);
