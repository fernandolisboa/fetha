import { pgTable, text, jsonb, timestamp, index, foreignKey } from "drizzle-orm/pg-core";
import type { PlanRules } from "@fetha/contracts";

import { user } from "../auth/schema";
import { contemplatedOperations } from "../portfolio/schema";

// A saved operation plan's rules (docs/adr/0079, UBIQUITOUS_LANGUAGE.md "Operation plan"): the
// contemplated operation it extends already carries the structure, legs and pricing; this is
// the plan's own half — the one-sentence reason, its exit rules and roll rule, each resolved to
// a session. One row per saved plan; a plan is never edited, only replaced by a new one.
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
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("operation_plan_rules_user_id_created_at_idx").on(table.userId, table.createdAt),
    index("operation_plan_rules_contemplated_operation_id_idx").on(table.contemplatedOperationId),
    foreignKey({
      columns: [table.contemplatedOperationId, table.userId],
      foreignColumns: [contemplatedOperations.id, contemplatedOperations.userId],
    }).onDelete("cascade"),
  ],
);
