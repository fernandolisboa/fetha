import { instantSchema, tickerSchema, type Ticker } from "@fetha/contracts";
import { engine } from "@fetha/engine";

import type { Database } from "@/db/client";
import { isProductionDeployment, readE2ESecret } from "@/modules/auth";
import { buildRadarView, latestCandle, tradingSessionForDate } from "@/modules/market-data";

import type { RadarLeg } from "./match";
import { saveRead, seedUniverse } from "./radar-repository";
import { SUGGESTION_LOT, suggestionFrom } from "./suggestion";
import { suggestionIdFor } from "./suggestions-repository";

const FIXTURE_RECIPE_ID = "bull-call-spread-low-iv";

export type SeedE2ERadarResult =
  | { ok: true; session: string; suggestionId: string | null }
  | { ok: false; reason: "e2e_not_available" | "no_market_data" };

// E2E only (the preview holds a few sessions, far short of the history a recipe reads): a
// radar row for `underlying` at its newest ingested close, with the engine's own reading and two
// calls from the real chain, filed under a recipe as if it had found an entry there, and the
// suggestion the engine prices for one lot of them. Idempotent per session: a suggestion a
// decision may already point at is never rewritten.
export async function seedE2ERadar(db: Database, underlying: Ticker): Promise<SeedE2ERadarResult> {
  if (isProductionDeployment() || !readE2ESecret()) {
    return { ok: false, reason: "e2e_not_available" };
  }

  const candle = await latestCandle(db, underlying);
  const trading = candle ? await tradingSessionForDate(db, candle.session) : null;
  if (!candle || !trading) return { ok: false, reason: "no_market_data" };

  const existing = await suggestionIdFor(db, underlying, trading.date, FIXTURE_RECIPE_ID);
  if (existing) return { ok: true, session: trading.date, suggestionId: existing };

  const at = instantSchema.parse(trading.close);
  const view = await buildRadarView(db, underlying, new Date(at));
  const reading = await engine.assetReading({ view, ticker: underlying, at });
  if (!reading.ok || reading.value.close === null) return { ok: false, reason: "no_market_data" };

  const spread = nearestBullCallSpread(
    view.optionSeries,
    Number(reading.value.close),
    trading.date,
  );
  if (!spread) return { ok: false, reason: "no_market_data" };
  const { bought, sold } = spread;

  const legs: RadarLeg[] = [bought, sold].map((series, index) => ({
    role: "call",
    side: index === 0 ? "buy" : "sell",
    ticker: series.ticker,
    strike: series.strike,
    expiry: series.expiry,
  }));
  const pricing = await engine.priceOperation({
    view,
    at,
    legs: legs.map((leg) => ({
      role: leg.role,
      side: leg.side,
      ticker: tickerSchema.parse(leg.ticker),
      quantity: SUGGESTION_LOT,
    })),
  });
  const suggestion = pricing.ok ? suggestionFrom(pricing.value, legs) : null;

  await seedUniverse(db, trading.date, new Date(at), [underlying]);
  await saveRead(db, {
    underlying,
    session: trading.date,
    asOf: new Date(at),
    reading: reading.value,
    matches: [
      {
        recipeId: FIXTURE_RECIPE_ID,
        facts: { close: reading.value.close, indicators: [] },
        legs,
        suggestion,
      },
    ],
  });
  const suggestionId = await suggestionIdFor(db, underlying, trading.date, FIXTURE_RECIPE_ID);
  return { ok: true, session: trading.date, suggestionId };
}

// The first expiry after `session` whose ladder lists a strike at or above `close` and a higher
// one: a short weekly ladder can stop below a close that has rallied since it was listed.
export function nearestBullCallSpread<
  Series extends { right: string; expiry: string; strike: string },
>(
  series: readonly Series[],
  close: number,
  session: string,
): { bought: Series; sold: Series } | null {
  const calls = series
    .filter((row) => row.right === "call" && row.expiry > session)
    .sort((a, b) => a.expiry.localeCompare(b.expiry) || Number(a.strike) - Number(b.strike));
  for (const expiry of new Set(calls.map((row) => row.expiry))) {
    const ladder = calls.filter((row) => row.expiry === expiry);
    const atTheMoney = ladder.findIndex((row) => Number(row.strike) >= close);
    const bought = ladder[atTheMoney];
    const sold = ladder.slice(atTheMoney + 1).find((row) => row.strike !== bought?.strike);
    if (bought && sold) return { bought, sold };
  }
  return null;
}
