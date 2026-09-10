import { asc } from "drizzle-orm";
import { structureSchema, type Structure } from "@fetha/contracts";

import type { Database } from "@/db/client";
import { structures } from "@/db/schema/structures";

// Shared reference data (docs/adr/0012, CLAUDE.md principle 5): every
// registered user reads the same catalog, so this repository takes no user
// and exposes no write method; only a migration or a seed script populates
// `structures`.
export class StructuresRepository {
  constructor(private readonly db: Database) {}

  async listAll(): Promise<Structure[]> {
    const rows = await this.db
      .select({ id: structures.id, name: structures.name, legs: structures.legs })
      .from(structures)
      .orderBy(asc(structures.name));

    return rows.map((row) =>
      structureSchema.parse({ id: row.id, name: row.name, expiry: "shared", legs: row.legs }),
    );
  }
}
