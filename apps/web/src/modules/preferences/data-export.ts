import { eq } from "drizzle-orm";

import type { DataExportTables } from "@/lib/data-export";
import { UserScopedRepository } from "@/lib/user-scoped-repository";

import { preferences } from "./schema";

export class PreferencesDataExport extends UserScopedRepository {
  async tables(): Promise<DataExportTables> {
    return {
      preferences: await this.db
        .select()
        .from(preferences)
        .where(eq(preferences.userId, this.userId)),
    };
  }
}
