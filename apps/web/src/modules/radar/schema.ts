import type { ThesisClaim } from "@fetha/contracts";
import type { AssetReading, Leg, OperationPricing, Score } from "@fetha/engine";
import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  date,
  foreignKey,
  index,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
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

// A radar match made concrete (docs/adr/0067): the structure one standard lot resolves to on the
// session's closing chain, the engine's pricing of it, and the claim it is scored on at its
// horizon (the options' expiry). Reference data like the match it belongs to: no user_id, written
// only by the nightly radar scan. A user's decision on it points here by `id`.
export const suggestions = pgTable(
  "suggestions",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    underlying: text("underlying").notNull(),
    session: date("session", { mode: "string" }).notNull(),
    recipeId: text("recipe_id").notNull(),
    asOf: timestamp("as_of", { withTimezone: true }).notNull(),
    legs: jsonb("legs").$type<Leg[]>().notNull(),
    pricing: jsonb("pricing").$type<OperationPricing>().notNull(),
    claim: jsonb("claim").$type<ThesisClaim>().notNull(),
    horizon: date("horizon", { mode: "string" }).notNull(),
  },
  (table) => [
    uniqueIndex("suggestions_underlying_session_recipe_id_idx").on(
      table.underlying,
      table.session,
      table.recipeId,
    ),
    index("suggestions_session_idx").on(table.session),
    foreignKey({
      columns: [table.underlying, table.session, table.recipeId],
      foreignColumns: [radarMatches.underlying, radarMatches.session, radarMatches.recipeId],
    }).onDelete("cascade"),
    check("suggestions_horizon_after_session_check", sql`${table.horizon} > ${table.session}`),
  ],
);

// The engine's score of a suggestion at its horizon (docs/adr/0067), one append-only row per
// suggestion (`suggestion_scores_no_update` trigger, hand-appended to the migration like
// `decision_scores_no_update`): the `Score` or a terminal `unscorable_reason`, plus the fields
// the journal's suggestion panel aggregates.
export const suggestionScores = pgTable(
  "suggestion_scores",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    suggestionId: text("suggestion_id")
      .notNull()
      .references(() => suggestions.id, { onDelete: "cascade" }),
    score: jsonb("score").$type<Score>(),
    unscorableReason: text("unscorable_reason"),
    claimHeld: boolean("claim_held"),
    pnlCentavos: bigint("pnl_centavos", { mode: "number" }),
    maxLossCentavos: bigint("max_loss_centavos", { mode: "number" }),
    normalizedPnl: numeric("normalized_pnl", { mode: "string" }),
    engineVersion: text("engine_version").notNull(),
    scoredAt: timestamp("scored_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("suggestion_scores_suggestion_id_idx").on(table.suggestionId),
    check(
      "suggestion_scores_score_xor_unscorable_check",
      sql`(${table.score} is not null and ${table.unscorableReason} is null)
        or (${table.score} is null and ${table.unscorableReason} is not null)`,
    ),
  ],
);
