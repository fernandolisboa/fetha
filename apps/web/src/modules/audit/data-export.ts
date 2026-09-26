import { eq } from "drizzle-orm";

import type { DataExportTables } from "@/lib/data-export";
import { UserScopedRepository } from "@/lib/user-scoped-repository";

import { accessLog } from "./schema";

export class AuditDataExport extends UserScopedRepository {
  async tables(): Promise<DataExportTables> {
    return {
      access_log: await this.db.select().from(accessLog).where(eq(accessLog.userId, this.userId)),
    };
  }
}
