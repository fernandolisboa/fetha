import { cache } from "react";
import { sessionDateSchema, type SessionDate } from "@fetha/contracts";

import { getDb, type Database } from "@/db/client";
import { todaySaoPauloDate } from "@/lib/today-sao-paulo";
import { forCurrentUser, readE2EToday } from "@/modules/auth";
import { nthTradingSessionAfter } from "@/modules/market-data";
import { WatchlistRepository } from "@/modules/watchlist";

import { suggestionCalibration, type SuggestionCalibration } from "./calibration";
import { latestRadar } from "./radar-repository";
import { radarView, type RadarView } from "./radar-view";
import { suggestionView, type SuggestionView } from "./suggestion-view";
import { suggestionWindow, type SuggestionWindow } from "./suggestion-window";
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
  const view = stored ? suggestionView(stored, await windowFor(db, stored.session)) : null;
  if (!view) throw new SuggestionNotFoundError();
  return view;
});

function suggestionToday(): SessionDate {
  const pinned = readE2EToday();
  return pinned ? sessionDateSchema.parse(pinned) : todaySaoPauloDate();
}

async function windowFor(db: Database, session: SessionDate): Promise<SuggestionWindow> {
  const next = await nthTradingSessionAfter(db, session, 1);
  return suggestionWindow(session, next?.date, suggestionToday());
}

export type TodaySuggestions =
  | { kind: "open"; suggestions: SuggestionView[] }
  | { kind: "archived"; session: SessionDate; openThrough: SessionDate }
  | { kind: "none" };

// Today's suggestions, the radar's newest read session while its window is open (docs/adr/0072),
// ordered like the radar's rows: by how many option series traded at the close, never by a
// score. Once that window closes the newest ones are archived and nothing older ever comes back.
export const getTodaySuggestions = cache(async (): Promise<TodaySuggestions> => {
  const db = getDb();
  const stored = await latestSuggestions(db);
  const [first] = stored;
  if (!first) return { kind: "none" };
  const window = await windowFor(db, first.session);
  const views = stored.flatMap((row) => suggestionView(row, window) ?? []);
  if (views.length === 0) return { kind: "none" };
  if (window.archived) {
    return { kind: "archived", session: first.session, openThrough: window.openThrough };
  }
  return {
    kind: "open",
    suggestions: views.sort(
      (a, b) =>
        (b.reading?.options.tradedSeries ?? 0) - (a.reading?.options.tradedSeries ?? 0) ||
        a.underlying.localeCompare(b.underlying) ||
        a.recipeId.localeCompare(b.recipeId),
    ),
  };
});

// Shared reference data like the suggestions themselves: the same calibration for every user.
export const getSuggestionCalibration = cache(async (): Promise<SuggestionCalibration> =>
  suggestionCalibration(await scoredSuggestions(getDb())),
);
