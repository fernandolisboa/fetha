import { pgTable, text, jsonb, timestamp } from "drizzle-orm/pg-core";
import type { LegTemplate } from "@fetha/contracts";

// Shared reference data (docs/adr/0012, CLAUDE.md principle 5): the catalog
// of structures every user reads, no user writes, seeded from
// src/modules/strategies/catalog.json (docs/adr/0053).
export const structures = pgTable("structures", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  legs: jsonb("legs").$type<LegTemplate[]>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});
