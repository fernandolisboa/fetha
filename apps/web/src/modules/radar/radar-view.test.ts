import { describe, expect, it } from "vitest";
import { decimalStringSchema, tickerSchema } from "@fetha/contracts";
import { assetReadingThresholds, type AssetReading } from "@fetha/engine";

import type { RadarFacts, RadarLeg } from "./match";
import type { StoredRadar } from "./radar-repository";
import { radarView } from "./radar-view";

function reading(ticker: string, tradedSeries: number): AssetReading {
  return {
    ticker: tickerSchema.parse(ticker),
    session: "2026-10-09",
    close: decimalStringSchema.parse("10"),
    trend: { label: "up", smaShort: null, smaLong: null },
    momentum: { label: "neutral", rsi: null },
    range: { label: "normal", atr: null, atrShare: null },
    impliedVolatility: { label: "low", ivRank: null, latest: null },
    options: { label: "liquid", session: "2026-10-09", tradedSeries, nextExpiries: [] },
    thresholds: assetReadingThresholds,
    notes: [],
    provenance: {
      engineVersion: "test",
      pricingModel: "bsm_continuous_yield",
      truncated: [],
      dataVersion: null,
      datasetNotes: [],
    },
  };
}

const facts: RadarFacts = { close: decimalStringSchema.parse("10"), indicators: [] };
const legs: RadarLeg[] = [
  { role: "call", side: "buy", ticker: tickerSchema.parse("ABCDK100"), strike: null, expiry: null },
];

function stored(): StoredRadar {
  return {
    session: "2026-10-09",
    readings: [
      { underlying: "AAAA3", reading: reading("AAAA3", 12) },
      { underlying: "BBBB3", reading: reading("BBBB3", 40) },
      { underlying: "CCCC3", reading: reading("CCCC3", 40) },
      { underlying: "DDDD3", reading: reading("DDDD3", 99) },
      { underlying: "EEEE3", reading: null },
    ],
    matches: [
      { underlying: "AAAA3", recipeId: "long-call-low-iv", facts, legs },
      { underlying: "CCCC3", recipeId: "bull-call-spread-low-iv", facts, legs },
      { underlying: "BBBB3", recipeId: "long-call-low-iv", facts, legs },
      { underlying: "BBBB3", recipeId: "long-straddle-low-iv", facts, legs },
      { underlying: "DDDD3", recipeId: "a-recipe-no-longer-in-the-book", facts, legs },
    ],
  };
}

describe("radarView", () => {
  it("lists only underlyings with a match, most traded option series first, ties by ticker", () => {
    const view = radarView(stored(), new Set());

    expect(view.rows.map((row) => row.ticker)).toEqual(["BBBB3", "CCCC3", "AAAA3"]);
    expect(view.rows[0]?.matches.map((match) => match.recipeName)).toEqual([
      "Compra de call",
      "Straddle comprado",
    ]);
  });

  it("counts the universe, what was read and what is still pending", () => {
    const view = radarView(stored(), new Set());

    expect(view).toMatchObject({ session: "2026-10-09", universe: 5, scanned: 4 });
    expect(view.pending).toEqual(["EEEE3"]);
  });

  it("marks the underlyings already on the user's watchlist", () => {
    const view = radarView(stored(), new Set(["CCCC3"]));

    expect(view.rows.find((row) => row.ticker === "CCCC3")?.onWatchlist).toBe(true);
    expect(view.rows.find((row) => row.ticker === "BBBB3")?.onWatchlist).toBe(false);
  });
});
