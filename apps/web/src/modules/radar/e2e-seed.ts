import { instantSchema, type Ticker } from "@fetha/contracts";
import { engine } from "@fetha/engine";

import type { Database } from "@/db/client";
import { isProductionDeployment, readE2ESecret } from "@/modules/auth";
import { buildRadarView, latestCandle, tradingSessionForDate } from "@/modules/market-data";

import type { RadarLeg } from "./match";
import { saveRead, seedUniverse } from "./radar-repository";

const FIXTURE_RECIPE_ID = "bull-call-spread-low-iv";

export type SeedE2ERadarResult =
  { ok: true; session: string } | { ok: false; reason: "e2e_not_available" | "no_market_data" };

// E2E only (the preview holds a few sessions, far short of the history a recipe reads): a
// radar row for `underlying` at its newest ingested close, with the engine's own reading and two
// calls from the real chain, filed under a recipe as if it had found an entry there.
export async function seedE2ERadar(db: Database, underlying: Ticker): Promise<SeedE2ERadarResult> {
  if (isProductionDeployment() || !readE2ESecret()) {
    return { ok: false, reason: "e2e_not_available" };
  }

  const candle = await latestCandle(db, underlying);
  const trading = candle ? await tradingSessionForDate(db, candle.session) : null;
  if (!candle || !trading) return { ok: false, reason: "no_market_data" };

  const at = instantSchema.parse(trading.close);
  const view = await buildRadarView(db, underlying, new Date(at));
  const reading = await engine.assetReading({ view, ticker: underlying, at });
  if (!reading.ok || reading.value.close === null) return { ok: false, reason: "no_market_data" };

  const close = Number(reading.value.close);
  const calls = view.optionSeries
    .filter((series) => series.right === "call" && series.expiry > trading.date)
    .sort((a, b) => a.expiry.localeCompare(b.expiry) || Number(a.strike) - Number(b.strike));
  const nearestExpiry = calls[0]?.expiry;
  const ladder = calls.filter((series) => series.expiry === nearestExpiry);
  const atTheMoney = ladder.findIndex((series) => Number(series.strike) >= close);
  const bought = ladder[atTheMoney];
  const sold = ladder.slice(atTheMoney + 1).find((series) => series.strike !== bought?.strike);
  if (atTheMoney < 0 || !bought || !sold) return { ok: false, reason: "no_market_data" };

  const legs: RadarLeg[] = [bought, sold].map((series, index) => ({
    role: "call",
    side: index === 0 ? "buy" : "sell",
    ticker: series.ticker,
    strike: series.strike,
    expiry: series.expiry,
  }));
  await seedUniverse(db, trading.date, new Date(at), [underlying]);
  await saveRead(db, {
    underlying,
    session: trading.date,
    reading: reading.value,
    matches: [
      {
        recipeId: FIXTURE_RECIPE_ID,
        facts: { close: reading.value.close, indicators: [] },
        legs,
      },
    ],
  });
  return { ok: true, session: trading.date };
}
