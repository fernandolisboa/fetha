import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import {
  decimalStringSchema,
  sessionDateSchema,
  tickerSchema,
  type DecimalString,
  type SessionDate,
  type Ticker,
} from "@fetha/contracts";

import { UserScopedRepository } from "@/lib/user-scoped-repository";

import type { LedgerFill } from "./bookkeeping";
import type { GroupRefusal } from "./operation-plan";
import {
  fills,
  operations,
  type AssetClass,
  type FillSide,
  type FillSource,
  type OperationStatus,
} from "./schema";

const INSERT_CHUNK = 1000;

export interface FillRecord extends LedgerFill {
  id: string;
  source: FillSource;
  operationId: string | null;
}

export interface OperationRecord {
  id: string;
  underlying: Ticker;
  status: OperationStatus;
  expiry: SessionDate | null;
  openedAt: SessionDate;
  closedAt: SessionDate | null;
}

export interface NewFill {
  ticker: Ticker;
  assetClass: AssetClass;
  side: FillSide;
  quantity: number;
  price: DecimalString;
  session: SessionDate;
  costsCentavos: number;
  expiry: SessionDate | null;
  source: FillSource;
  importKey: string | null;
}

export interface OperationWrite {
  underlying: Ticker;
  expiry: SessionDate | null;
  openedAt: SessionDate;
  status: Exclude<OperationStatus, "expired">;
  closedAt: SessionDate | null;
}

// Decides the operation's state from its complete fill set, inside the
// transaction that locks those fills (operation-plan.ts's `planOperation`).
export type PlanFromFills = (
  fills: FillRecord[],
) => { ok: true; state: OperationWrite } | { ok: false; reason: GroupRefusal };

export type GroupResult =
  | { ok: true; operationId: string }
  | { ok: false; reason: "fills_unavailable" | "operation_unavailable" | GroupRefusal };

export type WriteResult = { ok: true } | { ok: false; reason: "not_found" | "conflict" };

// A journal decision references the operation (ADR-0022 item 2): the
// database refuses the delete, so the append-only journal never points at an
// operation that no longer exists.
export type UngroupResult = WriteResult | { ok: false; reason: "has_decisions" };

function isForeignKeyViolation(error: unknown): boolean {
  const candidate = error instanceof Error && "cause" in error ? error.cause : error;
  return (
    typeof candidate === "object" &&
    candidate !== null &&
    "code" in candidate &&
    candidate.code === "23503"
  );
}

// Explicit rather than `.returning()`: a bare `.returning()` on `fills`
// cannot read back `seq`, an identity column drizzle marks as not-null only
// on select.
const FILL_COLUMNS = {
  id: fills.id,
  seq: fills.seq,
  ticker: fills.ticker,
  assetClass: fills.assetClass,
  side: fills.side,
  quantity: fills.quantity,
  price: fills.price,
  session: fills.session,
  costsCentavos: fills.costsCentavos,
  source: fills.source,
  expiry: fills.expiry,
  operationId: fills.operationId,
};

type FillRow = {
  [K in keyof typeof FILL_COLUMNS]: (typeof FILL_COLUMNS)[K]["_"]["data"] | null;
};

function toFillRecord(row: FillRow): FillRecord {
  return {
    id: row.id as string,
    seq: row.seq as number,
    ticker: tickerSchema.parse(row.ticker),
    assetClass: row.assetClass as AssetClass,
    side: row.side as FillSide,
    quantity: row.quantity as number,
    price: decimalStringSchema.parse(row.price),
    session: sessionDateSchema.parse(row.session),
    costsCentavos: row.costsCentavos as number,
    source: row.source as FillSource,
    expiry: row.expiry ? sessionDateSchema.parse(row.expiry) : null,
    operationId: row.operationId,
  };
}

function toOperationRecord(row: typeof operations.$inferSelect): OperationRecord {
  return {
    id: row.id,
    underlying: tickerSchema.parse(row.underlying),
    status: row.status,
    expiry: row.expiry,
    openedAt: row.openedAt,
    closedAt: row.closedAt,
  };
}

export class PortfolioRepository extends UserScopedRepository {
  async listFills(): Promise<FillRecord[]> {
    const rows = await this.db
      .select(FILL_COLUMNS)
      .from(fills)
      .where(eq(fills.userId, this.userId))
      .orderBy(asc(fills.session), asc(fills.seq));
    return rows.map(toFillRecord);
  }

  async listOperations(): Promise<OperationRecord[]> {
    const rows = await this.db
      .select()
      .from(operations)
      .where(eq(operations.userId, this.userId))
      .orderBy(asc(operations.openedAt), asc(operations.createdAt));
    return rows.map(toOperationRecord);
  }

  // Idempotent for import-keyed fills (ADR-0021 item 7): a key this user
  // already has is skipped, never duplicated or overwritten.
  async insertFills(newFills: readonly NewFill[]): Promise<{ inserted: number }> {
    if (newFills.length === 0) {
      return { inserted: 0 };
    }
    // Postgres caps one statement at 65,535 bind parameters (~13 per fill).
    return this.db.transaction(async (tx) => {
      let inserted = 0;
      for (let start = 0; start < newFills.length; start += INSERT_CHUNK) {
        const rows = await tx
          .insert(fills)
          .values(
            newFills
              .slice(start, start + INSERT_CHUNK)
              .map((fill) => ({ ...fill, userId: this.userId })),
          )
          .onConflictDoNothing({
            target: [fills.userId, fills.importKey],
            where: sql`${fills.importKey} is not null`,
          })
          .returning({ id: fills.id });
        inserted += rows.length;
      }
      return { inserted };
    });
  }

  // An option fill imported before its series reached the reference data is
  // stored without an expiry; a later import fills it in once it resolves.
  async resolveExpiries(resolved: readonly { id: string; expiry: SessionDate }[]): Promise<void> {
    for (const { id, expiry } of resolved) {
      await this.db
        .update(fills)
        .set({ expiry })
        .where(and(eq(fills.id, id), eq(fills.userId, this.userId), isNull(fills.expiry)));
    }
  }

  async deleteUnassignedFill(id: string): Promise<WriteResult> {
    const deleted = await this.db
      .delete(fills)
      .where(and(eq(fills.id, id), eq(fills.userId, this.userId), isNull(fills.operationId)))
      .returning({ id: fills.id });
    return deleted.length === 1 ? { ok: true } : { ok: false, reason: "not_found" };
  }

  // Assigns unassigned fills to a new operation (operationId null) or to an
  // open one, re-planning the operation from its whole fill set under row
  // locks so a concurrent grouping cannot take the same fill twice.
  async group(
    operationId: string | null,
    fillIds: readonly string[],
    plan: PlanFromFills,
  ): Promise<GroupResult> {
    const ids = [...new Set(fillIds)];
    if (ids.length === 0) {
      return { ok: false, reason: "fills_unavailable" };
    }
    return this.db.transaction(async (tx) => {
      if (operationId) {
        const [existing] = await tx
          .select({ id: operations.id })
          .from(operations)
          .where(
            and(
              eq(operations.id, operationId),
              eq(operations.userId, this.userId),
              eq(operations.status, "open"),
            ),
          )
          .for("update");
        if (!existing) {
          return { ok: false, reason: "operation_unavailable" };
        }
      }
      const selected = await tx
        .select(FILL_COLUMNS)
        .from(fills)
        .where(
          and(inArray(fills.id, ids), eq(fills.userId, this.userId), isNull(fills.operationId)),
        )
        .for("update");
      if (selected.length !== ids.length) {
        return { ok: false, reason: "fills_unavailable" };
      }
      const current = operationId
        ? await tx
            .select(FILL_COLUMNS)
            .from(fills)
            .where(and(eq(fills.operationId, operationId), eq(fills.userId, this.userId)))
            .for("update")
        : [];

      const planned = plan([...current, ...selected].map(toFillRecord));
      if (!planned.ok) {
        return { ok: false, reason: planned.reason };
      }

      let targetId = operationId;
      if (targetId) {
        await tx
          .update(operations)
          .set(planned.state)
          .where(and(eq(operations.id, targetId), eq(operations.userId, this.userId)));
      } else {
        const [created] = await tx
          .insert(operations)
          .values({ ...planned.state, userId: this.userId })
          .returning({ id: operations.id });
        targetId = created?.id ?? null;
      }
      if (!targetId) {
        throw new Error("failed to create operation");
      }
      await tx
        .update(fills)
        .set({ operationId: targetId })
        .where(and(inArray(fills.id, ids), eq(fills.userId, this.userId)));
      return { ok: true, operationId: targetId };
    });
  }

  async ungroup(operationId: string): Promise<UngroupResult> {
    try {
      return await this.ungroupInTransaction(operationId);
    } catch (error) {
      if (isForeignKeyViolation(error)) {
        return { ok: false, reason: "has_decisions" };
      }
      throw error;
    }
  }

  private async ungroupInTransaction(operationId: string): Promise<WriteResult> {
    return this.db.transaction(async (tx) => {
      const [existing] = await tx
        .select({ id: operations.id })
        .from(operations)
        .where(
          and(
            eq(operations.id, operationId),
            eq(operations.userId, this.userId),
            eq(operations.status, "open"),
          ),
        )
        .for("update");
      if (!existing) {
        return { ok: false, reason: "not_found" };
      }
      await tx
        .update(fills)
        .set({ operationId: null })
        .where(and(eq(fills.operationId, operationId), eq(fills.userId, this.userId)));
      await tx
        .delete(operations)
        .where(and(eq(operations.id, operationId), eq(operations.userId, this.userId)));
      return { ok: true };
    });
  }

  // Confirms a settlement (ADR-0021 item 6). `expectedFillIds` is the fill
  // set the proposal was computed from: if the operation changed since, the
  // write is refused rather than settling legs the user never saw.
  async settle(
    operationId: string,
    expectedFillIds: readonly string[],
    settlementFills: readonly Omit<NewFill, "source" | "importKey">[],
    closedAt: SessionDate,
  ): Promise<WriteResult> {
    return this.db.transaction(async (tx) => {
      const [existing] = await tx
        .select({ id: operations.id })
        .from(operations)
        .where(
          and(
            eq(operations.id, operationId),
            eq(operations.userId, this.userId),
            eq(operations.status, "open"),
          ),
        )
        .for("update");
      if (!existing) {
        return { ok: false, reason: "not_found" };
      }
      const current = await tx
        .select({ id: fills.id })
        .from(fills)
        .where(and(eq(fills.operationId, operationId), eq(fills.userId, this.userId)));
      const expected = new Set(expectedFillIds);
      if (current.length !== expected.size || current.some((row) => !expected.has(row.id))) {
        return { ok: false, reason: "conflict" };
      }
      if (settlementFills.length > 0) {
        await tx.insert(fills).values(
          settlementFills.map((fill) => ({
            ...fill,
            userId: this.userId,
            operationId,
            source: "settlement" as const,
            importKey: null,
          })),
        );
      }
      await tx
        .update(operations)
        .set({ status: "expired", closedAt })
        .where(and(eq(operations.id, operationId), eq(operations.userId, this.userId)));
      return { ok: true };
    });
  }
}
