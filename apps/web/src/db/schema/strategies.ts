import {
  pgTable,
  text,
  timestamp,
  jsonb,
  integer,
  uniqueIndex,
  index,
  check,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import type { StrategyDefinition } from "@fetha/contracts";

import { user } from "./auth";

export const strategyVisibilities = ["private", "shared"] as const;

export const strategies = pgTable(
  "strategies",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    visibility: text("visibility").notNull().default("private"),
    copiedFromStrategyId: text("copied_from_strategy_id").references(
      (): AnyPgColumn => strategies.id,
      { onDelete: "set null" },
    ),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("strategies_user_id_idx").on(table.userId),
    check("strategies_visibility_check", sql`${table.visibility} in ('private', 'shared')`),
  ],
);

// A version is immutable once inserted (docs/adr/0008, UBIQUITOUS_LANGUAGE.md
// "Strategy version"): the repository exposes no update method for this
// table, only inserts, so an edit is always a new row, never a mutation.
// The database enforces the same invariant with a trigger (migration
// 0002_flashy_wendell_rand.sql) that raises on any UPDATE, since Drizzle's
// schema builder has no first-class trigger API.
export const strategyVersions = pgTable(
  "strategy_versions",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    strategyId: text("strategy_id")
      .notNull()
      .references(() => strategies.id, { onDelete: "cascade" }),
    versionNumber: integer("version_number").notNull(),
    definition: jsonb("definition").$type<StrategyDefinition>().notNull(),
    definitionDigest: text("definition_digest").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("strategy_versions_strategy_id_version_number_idx").on(
      table.strategyId,
      table.versionNumber,
    ),
    index("strategy_versions_strategy_id_idx").on(table.strategyId),
  ],
);
