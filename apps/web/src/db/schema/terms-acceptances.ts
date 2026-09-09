import { pgTable, text, timestamp, index } from "drizzle-orm/pg-core";

import { user } from "./auth";

export const termsAcceptances = pgTable(
  "terms_acceptances",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    termsVersion: text("terms_version").notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("terms_acceptances_user_id_idx").on(table.userId)],
);
