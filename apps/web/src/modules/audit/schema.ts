import { index, pgTable, text, timestamp } from "drizzle-orm/pg-core";

import { user } from "../auth/schema";

export const accessLog = pgTable(
  "access_log",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    event: text("event").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).defaultNow().notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
  },
  (table) => [index("access_log_user_id_occurred_at_idx").on(table.userId, table.occurredAt)],
);
