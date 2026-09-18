import { bigint, integer, pgTable, text } from "drizzle-orm/pg-core";

// Better Auth's database-backed rate limiter reads and writes this exact
// shape directly by JS property name (key, count, lastRequest), not by SQL
// column name (better-auth/dist/api/rate-limiter/index.mjs); the Drizzle
// adapter resolves a model by looking up the export named after the model
// id ("rateLimit") in the schema module, so this export's name is load-
// bearing. Operational table like `invites`/`mail_outbox`: no `user_id`,
// only the rate limiter itself writes it (docs/adr/0016).
export const rateLimit = pgTable("rate_limits", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  key: text("key").notNull().unique(),
  count: integer("count").notNull(),
  lastRequest: bigint("last_request", { mode: "number" }).notNull(),
});
