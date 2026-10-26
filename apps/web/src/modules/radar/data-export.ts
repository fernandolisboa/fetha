import { eq } from "drizzle-orm";

import type { DataExportTables } from "@/lib/data-export";
import { UserScopedRepository } from "@/lib/user-scoped-repository";

import { suggestionSightings } from "./schema";

export class RadarDataExport extends UserScopedRepository {
  async tables(): Promise<DataExportTables> {
    return {
      suggestion_sightings: await this.db
        .select()
        .from(suggestionSightings)
        .where(eq(suggestionSightings.userId, this.userId)),
    };
  }
}
