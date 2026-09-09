import { pgTable, text, boolean, timestamp, index } from "drizzle-orm/pg-core";

import { user } from "./auth";

export const preferences = pgTable(
  "preferences",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    userId: text("user_id")
      .notNull()
      .unique()
      .references(() => user.id, { onDelete: "cascade" }),
    theme: text("theme").notNull().default("instrumento"),
    railCollapsed: boolean("rail_collapsed").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [index("preferences_user_id_idx").on(table.userId)],
);
