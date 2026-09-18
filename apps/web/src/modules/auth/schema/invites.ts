import { pgTable, text, timestamp } from "drizzle-orm/pg-core";

import { user } from "./better-auth";

export const invites = pgTable("invites", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  email: text("email").notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  consumedAt: timestamp("consumed_at", { withTimezone: true }),
  consumedByUserId: text("consumed_by_user_id").references(() => user.id, {
    onDelete: "set null",
  }),
});
