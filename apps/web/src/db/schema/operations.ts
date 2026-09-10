import { pgTable, text, bigint, jsonb, timestamp, date, index } from "drizzle-orm/pg-core";
import type { ContemplatedLeg } from "@fetha/contracts";

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
    legs: jsonb("legs").$type<ContemplatedLeg[]>().notNull(),
    session: date("session", { mode: "string" }).notNull(),
    netPremiumCentavos: bigint("net_premium_centavos", { mode: "number" }).notNull(),
    maxLossCentavos: bigint("max_loss_centavos", { mode: "number" }),
    maxGainCentavos: bigint("max_gain_centavos", { mode: "number" }),
    breachedLimits: jsonb("breached_limits").$type<string[]>().notNull().default([]),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("contemplated_operations_user_id_created_at_idx").on(table.userId, table.createdAt),
  ],
);
