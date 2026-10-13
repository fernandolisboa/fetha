import type { AssetReading } from "@fetha/engine";

import { recipeById } from "@/modules/strategies";

import type { RadarFacts, RadarLeg } from "./match";
import type { StoredRadar } from "./radar-repository";

export interface RadarRowMatch {
  recipeId: string;
  recipeName: string;
  facts: RadarFacts;
  legs: RadarLeg[];
}

export interface RadarRow {
  ticker: string;
  reading: AssetReading;
  onWatchlist: boolean;
  matches: RadarRowMatch[];
}

export interface RadarView {
  session: string;
  universe: number;
  scanned: number;
  pending: string[];
  rows: RadarRow[];
}

// One row per underlying where a recipe found an entry, ordered by how many option series
// traded at the close, never by a score (docs/adr/0066). A match for a recipe the book no
// longer holds is dropped.
export function radarView(radar: StoredRadar, watched: ReadonlySet<string>): RadarView {
  const readings = new Map(
    radar.readings.flatMap((row) => (row.reading ? [[row.underlying, row.reading] as const] : [])),
  );
  const matchesByTicker = new Map<string, RadarRowMatch[]>();
  for (const match of radar.matches) {
    const recipe = recipeById(match.recipeId);
    if (!recipe) continue;
    const list = matchesByTicker.get(match.underlying) ?? [];
    list.push({
      recipeId: match.recipeId,
      recipeName: recipe.definition.name,
      facts: match.facts,
      legs: match.legs,
    });
    matchesByTicker.set(match.underlying, list);
  }

  const rows = [...matchesByTicker.entries()]
    .flatMap(([ticker, matches]) => {
      const reading = readings.get(ticker);
      return reading ? [{ ticker, reading, onWatchlist: watched.has(ticker), matches }] : [];
    })
    .sort(
      (a, b) =>
        b.reading.options.tradedSeries - a.reading.options.tradedSeries ||
        a.ticker.localeCompare(b.ticker),
    );

  return {
    session: radar.session,
    universe: radar.readings.length,
    scanned: readings.size,
    pending: radar.readings.filter((row) => !row.reading).map((row) => row.underlying),
    rows,
  };
}
