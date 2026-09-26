import { sql } from "drizzle-orm";
import { check, index, pgTable, text, timestamp } from "drizzle-orm/pg-core";

import { user } from "../auth/schema";
import { accessEventSchema } from "./events";

const events = accessEventSchema.options.map((event) => `'${event}'`).join(", ");

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
  (table) => [
    index("access_log_user_id_occurred_at_idx").on(table.userId, table.occurredAt),
    index("access_log_occurred_at_idx").on(table.occurredAt),
    check("access_log_event_check", sql`${table.event} in (${sql.raw(events)})`),
  ],
);
