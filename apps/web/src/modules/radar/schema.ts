import type { AssetReading } from "@fetha/engine";
import {
  date,
  foreignKey,
  index,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

import type { RadarFacts, RadarLeg } from "./match";

// Reference data (docs/adr/0066): no user_id, written only by the nightly radar scan and read
// by every user, the same class as the IV index. A row with a null `reading` is an underlying
// of the session's universe the scan has not reached yet (pending).
export const radarReadings = pgTable(
  "radar_readings",
  {
    underlying: text("underlying").notNull(),
    session: date("session", { mode: "string" }).notNull(),
    asOf: timestamp("as_of", { withTimezone: true }).notNull(),
    reading: jsonb("reading").$type<AssetReading>(),
    computedAt: timestamp("computed_at", { withTimezone: true }),
  },
  (table) => [
    primaryKey({ columns: [table.underlying, table.session] }),
    index("radar_readings_session_idx").on(table.session),
  ],
);

export const radarMatches = pgTable(
  "radar_matches",
  {
    underlying: text("underlying").notNull(),
    session: date("session", { mode: "string" }).notNull(),
    recipeId: text("recipe_id").notNull(),
    facts: jsonb("facts").$type<RadarFacts>().notNull(),
    legs: jsonb("legs").$type<RadarLeg[]>().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.underlying, table.session, table.recipeId] }),
    foreignKey({
      columns: [table.underlying, table.session],
      foreignColumns: [radarReadings.underlying, radarReadings.session],
    }).onDelete("cascade"),
  ],
);
