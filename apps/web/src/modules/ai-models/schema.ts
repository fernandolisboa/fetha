import { jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";

import { user } from "../auth/schema";

export const aiSettings = pgTable("ai_settings", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  userId: text("user_id")
    .notNull()
    .unique()
    .references(() => user.id, { onDelete: "cascade" }),
  // A partial `AiSettingsModelFamilies` (`@fetha/contracts`), validated at
  // read and write: a kind absent here falls back to its default family.
  modelFamilies: jsonb("model_families").notNull().default({}),
  // Never read back by a page or an export: `apiKeyCiphertext` is the only
  // column an action may decrypt, and only to hand the plaintext to the
  // Anthropic SDK (docs/adr/0068).
  apiKeyCiphertext: text("api_key_ciphertext"),
  apiKeyLast4: text("api_key_last4"),
  apiKeyUpdatedAt: timestamp("api_key_updated_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull(),
});
