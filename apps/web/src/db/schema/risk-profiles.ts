import { pgTable, text, bigint, jsonb, timestamp, index } from "drizzle-orm/pg-core";
import type { RiskProfile } from "@fetha/contracts";

import { user } from "./auth";

// Append-only history (UBIQUITOUS_LANGUAGE.md "Risk profile", CLAUDE.md
// principle 5): every edit in settings inserts a new row, the current
// profile is the latest by `created_at` for the user, and no repository
// method updates or deletes a row.
export const riskProfiles = pgTable(
  "risk_profiles",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    declaredCapital: bigint("declared_capital", { mode: "number" }).notNull(),
    limits: jsonb("limits").$type<RiskProfile["limits"]>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("risk_profiles_user_id_created_at_idx").on(table.userId, table.createdAt)],
);
