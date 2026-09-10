import { pgTable, text, integer, jsonb, timestamp, date, index } from "drizzle-orm/pg-core";
import type { OperationLeg } from "@fetha/contracts";

import { user } from "./auth";
import { structures } from "./structures";

// A contemplated operation (UBIQUITOUS_LANGUAGE.md "Decision"/"Operation"):
// the builder's saved snapshot of a priced structure, not a real fill. The
// pricing numbers are stored as they were computed at save time, so a saved
// operation reads back the same way it looked when the user decided,
// independent of later market moves; re-pricing it is a new operation.
export const contemplatedOperations = pgTable(
  "contemplated_operations",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    structureId: text("structure_id")
      .notNull()
      .references(() => structures.id),
    underlying: text("underlying").notNull(),
    legs: jsonb("legs").$type<OperationLeg[]>().notNull(),
    session: date("session", { mode: "string" }).notNull(),
    netPremiumCentavos: integer("net_premium_centavos").notNull(),
    maxLossCentavos: integer("max_loss_centavos"),
    maxGainCentavos: integer("max_gain_centavos"),
    breachedLimits: jsonb("breached_limits").$type<string[]>().notNull().default([]),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("contemplated_operations_user_id_created_at_idx").on(table.userId, table.createdAt),
  ],
);
