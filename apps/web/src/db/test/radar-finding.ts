import { inArray } from "drizzle-orm";
import { decimalStringSchema } from "@fetha/contracts";
import type { AssetReading } from "@fetha/engine";

import type { Database } from "@/db/client";
import { radarLegsSchema } from "@/modules/radar/match";
import { radarMatches, radarReadings } from "@/modules/radar/schema";

// A read radar row and one match for `underlying` at `session`: all a consumer of the radar's
// recent findings sees, with no suggestion. Cleanup removes the rows (the match cascades).
export async function seedRadarFinding(
  db: Database,
  underlying: string,
  session: string,
  expiry = "2191-01-17",
): Promise<() => Promise<void>> {
  await db.insert(radarReadings).values({
    underlying,
    session,
    asOf: new Date(`${session}T20:00:00.000Z`),
    reading: {} as AssetReading,
  });
  await db.insert(radarMatches).values({
    underlying,
    session,
    recipeId: "bull-call-spread-low-iv",
    facts: { close: decimalStringSchema.parse("10.00"), indicators: [] },
    legs: radarLegsSchema.parse([
      {
        role: "call",
        side: "buy",
        ticker: `${underlying.slice(0, 4)}G310`,
        strike: decimalStringSchema.parse("31.00"),
        expiry,
      },
    ]),
  });
  return async () => {
    await db.delete(radarReadings).where(inArray(radarReadings.underlying, [underlying]));
  };
}
