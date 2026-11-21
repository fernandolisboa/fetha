import { and, desc, eq } from "drizzle-orm";
import { sessionDateSchema, type Instant, type SessionDate } from "@fetha/contracts";

import type { Executor } from "@/db/client";
import { UserScopedRepository } from "@/lib/user-scoped-repository";

import { planSignals } from "./schema";
import { planSignalKinds, type PlanSignalKind } from "./plan-signal-rules";

export interface NewPlanSignal {
  operationPlanRulesId: string;
  operationId: string;
  kind: PlanSignalKind;
  session: SessionDate;
  at: Instant;
}

export interface PlanSignalListItem {
  id: string;
  operationPlanRulesId: string;
  operationId: string;
  kind: PlanSignalKind;
  session: SessionDate;
  createdAt: Date;
}

function toPlanSignalKind(value: string): PlanSignalKind {
  const kind = planSignalKinds.find((candidate) => candidate === value);
  if (!kind) throw new Error(`unknown plan signal kind: ${value}`);
  return kind;
}

export class PlanSignalsRepository extends UserScopedRepository {
  // Idempotent: the unique index on `(user, operation, kind)` is what actually dedupes a
  // condition that is still true the next night, this is only the insert side of that.
  async createMany(rows: readonly NewPlanSignal[], executor: Executor = this.db): Promise<number> {
    if (rows.length === 0) return 0;
    const inserted = await executor
      .insert(planSignals)
      .values(
        rows.map((row) => ({
          userId: this.userId,
          operationPlanRulesId: row.operationPlanRulesId,
          operationId: row.operationId,
          kind: row.kind,
          session: row.session,
          at: new Date(row.at),
        })),
      )
      .onConflictDoNothing({
        target: [planSignals.userId, planSignals.operationId, planSignals.kind],
      })
      .returning({ id: planSignals.id });
    return inserted.length;
  }

  async listMine(): Promise<PlanSignalListItem[]> {
    const rows = await this.db
      .select()
      .from(planSignals)
      .where(eq(planSignals.userId, this.userId))
      .orderBy(desc(planSignals.createdAt));
    return rows.map((row) => ({
      id: row.id,
      operationPlanRulesId: row.operationPlanRulesId,
      operationId: row.operationId,
      kind: toPlanSignalKind(row.kind),
      session: sessionDateSchema.parse(row.session),
      createdAt: row.createdAt,
    }));
  }

  // A foreign id resolves to nothing, the same way `SignalsRepository.findMine` scopes by this
  // user's own id (isolation test).
  async findMine(id: string): Promise<PlanSignalListItem | null> {
    const [row] = await this.db
      .select()
      .from(planSignals)
      .where(and(eq(planSignals.id, id), eq(planSignals.userId, this.userId)));
    if (!row) return null;
    return {
      id: row.id,
      operationPlanRulesId: row.operationPlanRulesId,
      operationId: row.operationId,
      kind: toPlanSignalKind(row.kind),
      session: sessionDateSchema.parse(row.session),
      createdAt: row.createdAt,
    };
  }
}
