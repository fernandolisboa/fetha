import { pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const mailOutbox = pgTable("mail_outbox", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  to: text("to").notNull(),
  subject: text("subject").notNull(),
  text: text("text").notNull(),
  html: text("html").notNull(),
  sentAt: timestamp("sent_at", { withTimezone: true }).defaultNow().notNull(),
});
