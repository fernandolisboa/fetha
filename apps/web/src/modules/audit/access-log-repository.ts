import { and, desc, eq, isNotNull, lt, or, sql } from "drizzle-orm";

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

export interface AccessLogFilters {
  from?: string;
  to?: string;
  event?: AccessEvent;
  ipAddress?: string;
}

export interface AccessLogCursor {
  occurredAt: Date;
  id: string;
}

export interface AccessLogPage {
  entries: AccessLogEntry[];
  nextCursor: AccessLogCursor | null;
}

const ORIGINS_LIMIT = 100;
const TIME_ZONE = "America/Sao_Paulo";

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

  // Keyset pagination on (occurred_at desc, id desc): a page's last row
  // becomes the next page's cursor, so no page ever shifts under a
  // concurrently inserted row the way an OFFSET would. `from`/`to` are São
  // Paulo calendar days (inclusive); the cast-then-"at time zone" idiom below
  // keeps the comparison sargable against the (user_id, occurred_at) index
  // instead of calling a timezone function on every row.
  async listPage(
    filters: AccessLogFilters,
    cursor: AccessLogCursor | null,
    limit: number,
  ): Promise<AccessLogPage> {
    const where = and(...this.filterConditions(filters), ...this.cursorCondition(cursor));
    const rows = await this.db
      .select({
        id: accessLog.id,
        event: accessLog.event,
        occurredAt: accessLog.occurredAt,
        ipAddress: accessLog.ipAddress,
        userAgent: accessLog.userAgent,
      })
      .from(accessLog)
      .where(where)
      .orderBy(desc(accessLog.occurredAt), desc(accessLog.id))
      .limit(limit + 1);

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const last = page.at(-1);
    const nextCursor = hasMore && last ? { occurredAt: last.occurredAt, id: last.id } : null;

    return {
      entries: page.map((row) => ({ ...row, event: accessEventSchema.parse(row.event) })),
      nextCursor,
    };
  }

  async count(filters: AccessLogFilters): Promise<number> {
    const [row] = await this.db
      .select({ count: sql<string>`count(*)` })
      .from(accessLog)
      .where(and(...this.filterConditions(filters)));
    return Number(row?.count ?? 0);
  }

  async listOrigins(): Promise<string[]> {
    const rows = await this.db
      .select({ ipAddress: accessLog.ipAddress })
      .from(accessLog)
      .where(and(eq(accessLog.userId, this.userId), isNotNull(accessLog.ipAddress)))
      .groupBy(accessLog.ipAddress)
      .orderBy(desc(sql`max(${accessLog.occurredAt})`))
      .limit(ORIGINS_LIMIT);
    return rows.map((row) => row.ipAddress).filter((ip): ip is string => ip !== null);
  }

  private filterConditions(filters: AccessLogFilters) {
    const conditions = [eq(accessLog.userId, this.userId)];
    if (filters.from) {
      conditions.push(
        sql`${accessLog.occurredAt} >= (${filters.from}::date::timestamp at time zone ${TIME_ZONE})`,
      );
    }
    if (filters.to) {
      conditions.push(
        sql`${accessLog.occurredAt} < ((${filters.to}::date + 1)::timestamp at time zone ${TIME_ZONE})`,
      );
    }
    if (filters.event) {
      conditions.push(eq(accessLog.event, filters.event));
    }
    if (filters.ipAddress) {
      conditions.push(eq(accessLog.ipAddress, filters.ipAddress));
    }
    return conditions;
  }

  private cursorCondition(cursor: AccessLogCursor | null) {
    if (!cursor) {
      return [];
    }
    return [
      or(
        lt(accessLog.occurredAt, cursor.occurredAt),
        and(eq(accessLog.occurredAt, cursor.occurredAt), lt(accessLog.id, cursor.id)),
      ),
    ];
  }
}
