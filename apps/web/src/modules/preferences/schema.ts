import { sql } from "drizzle-orm";
import { pgTable, text, boolean, timestamp, integer, check } from "drizzle-orm/pg-core";

import { user } from "../auth/schema";

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
    layout: text("layout").notNull().default("workspace"),
    railCollapsed: boolean("rail_collapsed").notNull().default(false),
    tourDismissedAt: timestamp("tour_dismissed_at", { withTimezone: true }),
    assetTourDismissedAt: timestamp("asset_tour_dismissed_at", { withTimezone: true }),
    suggestionArchiveAfterHours: integer("suggestion_archive_after_hours"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    check(
      "preferences_suggestion_archive_after_hours_positive",
      sql`${table.suggestionArchiveAfterHours} > 0`,
    ),
  ],
);
