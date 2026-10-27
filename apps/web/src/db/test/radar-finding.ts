import { and, eq } from "drizzle-orm";
import { decimalStringSchema } from "@fetha/contracts";
import type { AssetReading } from "@fetha/engine";

import type { Database } from "@/db/client";
import { radarLegsSchema } from "@/modules/radar/match";
import { radarMatches, radarReadings } from "@/modules/radar/schema";

// A read radar row and one match for `underlying` at `session`: all a consumer of the radar's
// recent findings sees, with no suggestion. Both rows go in together; cleanup removes exactly
// them (the match cascades).
export async function seedRadarFinding(
  db: Database,
  underlying: string,
  session: string,
): Promise<() => Promise<void>> {
  await db.transaction(async (tx) => {
    await tx.insert(radarReadings).values({
      underlying,
      session,
      asOf: new Date(`${session}T20:00:00.000Z`),
      reading: {} as AssetReading,
    });
    await tx.insert(radarMatches).values({
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
          expiry: "2191-01-17",
        },
      ]),
    });
  });
  return async () => {
    await db
      .delete(radarReadings)
      .where(and(eq(radarReadings.underlying, underlying), eq(radarReadings.session, session)));
  };
}
