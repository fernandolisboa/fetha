import {
  pgTable,
  text,
  jsonb,
  timestamp,
  date,
  index,
  foreignKey,
  uniqueIndex,
  check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import type { PlanRules } from "@fetha/contracts";

import { user } from "../auth/schema";
import { contemplatedOperations, operations } from "../portfolio/schema";
import { planSignalKinds } from "./plan-signal-rules";

// A saved operation plan's rules (docs/adr/0079, UBIQUITOUS_LANGUAGE.md "Operation plan"): the
// contemplated operation it extends already carries the structure, legs and pricing; this is
// the plan's own half — the one-sentence reason, its exit rules and roll rule, each resolved to
// a session. One row per saved plan; a plan is never edited, only replaced by a new one.
//
// `operationId` (docs/adr/0079 addendum, ticket #381) points at the real portfolio operation
// "Executei" turned this plan into: null until executed, then the composite
// `(operation_id, user_id)` foreign key binds it to this same user's own operation (the `fills`
// pattern) and the unique index caps it at one — a plan can execute at most once.
export const operationPlanRules = pgTable(
  "operation_plan_rules",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    contemplatedOperationId: text("contemplated_operation_id").notNull(),
    recipeId: text("recipe_id").notNull(),
    rules: jsonb("rules").$type<PlanRules>().notNull(),
    operationId: text("operation_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("operation_plan_rules_user_id_created_at_idx").on(table.userId, table.createdAt),
    index("operation_plan_rules_contemplated_operation_id_idx").on(table.contemplatedOperationId),
    uniqueIndex("operation_plan_rules_operation_id_idx").on(table.operationId),
    foreignKey({
      columns: [table.contemplatedOperationId, table.userId],
      foreignColumns: [contemplatedOperations.id, contemplatedOperations.userId],
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.operationId, table.userId],
      foreignColumns: [operations.id, operations.userId],
    }),
  ],
);

// The nightly alert this plan's rules fired for an executed, open operation (ADR-0079 addendum,
// ticket #381): target hit, stop hit or roll due. Deduplicated at the database level, not by
// discipline — `(user, operation, kind)` is unique, so a condition that is still true the next
// night writes nothing new (`onConflictDoNothing`), never a second alert for the same thing.
export const planSignals = pgTable(
  "plan_signals",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    operationPlanRulesId: text("operation_plan_rules_id").notNull(),
    operationId: text("operation_id").notNull(),
    kind: text("kind").notNull(),
    session: date("session", { mode: "string" }).notNull(),
    at: timestamp("at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("plan_signals_user_operation_kind_idx").on(
      table.userId,
      table.operationId,
      table.kind,
    ),
    index("plan_signals_user_id_created_at_idx").on(table.userId, table.createdAt),
    foreignKey({
      columns: [table.operationPlanRulesId, table.userId],
      foreignColumns: [operationPlanRules.id, operationPlanRules.userId],
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.operationId, table.userId],
      foreignColumns: [operations.id, operations.userId],
    }).onDelete("cascade"),
    check(
      "plan_signals_kind_check",
      sql`${table.kind} in (${sql.raw(planSignalKinds.map((kind) => `'${kind}'`).join(", "))})`,
    ),
  ],
);
