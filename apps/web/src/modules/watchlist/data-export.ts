import { eq } from "drizzle-orm";

import type { DataExportTables } from "@/lib/data-export";
import { UserScopedRepository } from "@/lib/user-scoped-repository";

import { watchlistItems } from "./schema";

export class WatchlistDataExport extends UserScopedRepository {
  async tables(): Promise<DataExportTables> {
    return {
      watchlist_items: await this.db
        .select()
        .from(watchlistItems)
        .where(eq(watchlistItems.userId, this.userId)),
    };
  }
}
