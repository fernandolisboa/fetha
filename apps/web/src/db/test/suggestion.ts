import { eq } from "drizzle-orm";
import { thesisClaimSchema, type Ticker } from "@fetha/contracts";
import type { AssetReading, OperationPricing } from "@fetha/engine";

import type { Database } from "@/db/client";
import { radarLegsSchema } from "@/modules/radar/match";
import { radarMatches, radarReadings, suggestions } from "@/modules/radar/schema";

export interface SeededSuggestion {
  id: string;
  cleanup: () => Promise<void>;
}

// A radar row, its match and the suggestion the scan would have stored for one lot of a bull
// call spread on `underlying`, written directly so decision and analysis tests need no chain.
// Cleanup removes the radar row (cascading to the suggestion); a decision pointing at it must
// be gone first.
export async function seedSuggestion(
  db: Database,
  underlying: Ticker,
  session = "2031-06-02",
  expiry = "2031-07-18",
): Promise<SeededSuggestion> {
  const asOf = new Date(`${session}T20:00:00.000Z`);
  const bought = `${underlying.slice(0, 4)}G310`;
  const sold = `${underlying.slice(0, 4)}G330`;
  const pricing = {
    at: asOf.toISOString(),
    underlying,
    spot: "31.20",
    riskFreeRate: "0.1065",
    dividendYield: "0",
    legs: [
      {
        leg: { role: "call", side: "buy", ticker: bought, quantity: 100 },
        price: "1.90",
        priceSource: "close",
        stale: null,
      },
      {
        leg: { role: "call", side: "sell", ticker: sold, quantity: 100 },
        price: "0.95",
        priceSource: "close",
        stale: null,
      },
    ],
    netPremium: -9500,
    greeks: { delta: "21.4", gamma: "3.1", theta: "-0.8", vega: "4.2", rho: "1.1" },
    payoff: [
      { underlying: "28.00", pnl: -9500 },
      { underlying: "35.00", pnl: 10500 },
    ],
    breakEvens: ["31.95"],
    maxLoss: 9500,
    maxGain: 10500,
    limitBreaches: [],
    notes: [],
    provenance: { engineVersion: "test", inputs: [] },
  } as unknown as OperationPricing;

  await db.insert(radarReadings).values({ underlying, session, asOf, reading: null });
  await db.insert(radarMatches).values({
    underlying,
    session,
    recipeId: "bull-call-spread-low-iv",
    facts: { close: pricing.spot, indicators: [] },
    legs: radarLegsSchema.parse([
      { role: "call", side: "buy", ticker: bought, strike: "31.00", expiry },
      { role: "call", side: "sell", ticker: sold, strike: "33.00", expiry },
    ]),
  });
  const [row] = await db
    .insert(suggestions)
    .values({
      underlying,
      session,
      recipeId: "bull-call-spread-low-iv",
      asOf,
      legs: pricing.legs.map(({ leg }) => leg),
      pricing,
      claim: thesisClaimSchema.parse({
        kind: "close_above",
        instrument: underlying,
        level: "31.95",
      }),
      horizon: expiry,
    })
    .returning({ id: suggestions.id });
  if (!row) throw new Error("test setup: expected a suggestion");

  return {
    id: row.id,
    cleanup: async () => {
      await db.delete(radarReadings).where(eq(radarReadings.underlying, underlying));
    },
  };
}

// A read radar row for a throwaway underlying at `session`: enough for the radar to count that
// close as read (docs/adr/0073), with no suggestion of its own. Cleanup removes it.
export async function seedRadarRead(db: Database, session: string): Promise<() => Promise<void>> {
  const underlying = `RR${crypto.randomUUID().replaceAll("-", "").slice(0, 6).toUpperCase()}`;
  await db.insert(radarReadings).values({
    underlying,
    session,
    asOf: new Date(`${session}T20:00:00.000Z`),
    reading: {} as AssetReading,
  });
  return async () => {
    await db.delete(radarReadings).where(eq(radarReadings.underlying, underlying));
  };
}
