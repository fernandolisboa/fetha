import { pgTable, text, boolean, timestamp } from "drizzle-orm/pg-core";

import { user } from "../auth/schema";

export const preferences = pgTable("preferences", {
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
});
