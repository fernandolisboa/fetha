import { desc, eq } from "drizzle-orm";

import { UserScopedRepository } from "@/lib/user-scoped-repository";

import { accessEventSchema, type AccessEvent } from "./events";
import type { AccessContext } from "./request-context";
import { accessLog } from "./schema";

export interface AccessLogEntry {
  id: string;
  event: AccessEvent;
  occurredAt: Date;
  ipAddress: string | null;
  userAgent: string | null;
}

export class AccessLogRepository extends UserScopedRepository {
  async record(event: AccessEvent, context: AccessContext, at: Date = new Date()): Promise<void> {
    await this.db.insert(accessLog).values({
      userId: this.userId,
      event,
      occurredAt: at,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
    });
  }

  async listRecent(limit: number): Promise<AccessLogEntry[]> {
    const rows = await this.db
      .select({
        id: accessLog.id,
        event: accessLog.event,
        occurredAt: accessLog.occurredAt,
        ipAddress: accessLog.ipAddress,
        userAgent: accessLog.userAgent,
      })
      .from(accessLog)
      .where(eq(accessLog.userId, this.userId))
      .orderBy(desc(accessLog.occurredAt))
      .limit(limit);
    return rows.map((row) => ({ ...row, event: accessEventSchema.parse(row.event) }));
  }
}
