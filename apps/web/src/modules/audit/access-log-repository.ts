import { and, desc, eq, lt } from "drizzle-orm";

import { UserScopedRepository } from "@/lib/user-scoped-repository";

import { accessEventSchema, type AccessEvent } from "./events";
import type { AccessContext } from "./request-context";
import { accessLog } from "./schema";

export const ACCESS_LOG_RETENTION_DAYS = 180;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface AccessLogEntry {
  id: string;
  event: AccessEvent;
  occurredAt: Date;
  ipAddress: string | null;
  userAgent: string | null;
}

export class AccessLogRepository extends UserScopedRepository {
  async record(event: AccessEvent, context: AccessContext, at: Date = new Date()): Promise<void> {
    const cutoff = new Date(at.getTime() - ACCESS_LOG_RETENTION_DAYS * DAY_MS);
    await this.db
      .delete(accessLog)
      .where(and(eq(accessLog.userId, this.userId), lt(accessLog.occurredAt, cutoff)));
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
