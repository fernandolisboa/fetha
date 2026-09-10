import { pgTable, text, timestamp, uniqueIndex, index } from "drizzle-orm/pg-core";

import { user } from "./auth";

// One row per instrument a user follows (CONTEXT.md: watchlists are owned by
// the strategies module). The unique index doubles as the natural key, so
// adding an instrument already on the list is an upsert, not a duplicate row.
export const watchlistItems = pgTable(
  "watchlist_items",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    ticker: text("ticker").notNull(),
    addedAt: timestamp("added_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("watchlist_items_user_id_ticker_idx").on(table.userId, table.ticker),
    index("watchlist_items_user_id_idx").on(table.userId),
  ],
);
