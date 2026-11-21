import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { planRulesSchema, type PlanRules } from "@fetha/contracts";

import type { Executor } from "@/db/client";
import { UserScopedRepository } from "@/lib/user-scoped-repository";

import { operationPlanRules } from "./schema";

export interface SavePlanRulesInput {
  contemplatedOperationId: string;
  recipeId: string;
  rules: PlanRules;
}

export interface SavedPlanRules extends SavePlanRulesInput {
  id: string;
  // The real portfolio operation "Executei" turned this plan into (ticket #381): null until
  // executed, then set exactly once (the unique index on `operation_id` refuses a second link).
  operationId: string | null;
  createdAt: Date;
}

function toSavedPlanRules(row: typeof operationPlanRules.$inferSelect): SavedPlanRules {
  return {
    id: row.id,
    contemplatedOperationId: row.contemplatedOperationId,
    recipeId: row.recipeId,
    rules: planRulesSchema.parse(row.rules),
    operationId: row.operationId,
    createdAt: row.createdAt,
  };
}

export class PlanRulesRepository extends UserScopedRepository {
  async save(input: SavePlanRulesInput, executor: Executor = this.db): Promise<{ id: string }> {
    const [row] = await executor
      .insert(operationPlanRules)
      .values({
        userId: this.userId,
        contemplatedOperationId: input.contemplatedOperationId,
        recipeId: input.recipeId,
        rules: input.rules,
      })
      .returning({ id: operationPlanRules.id });

    if (!row) {
      throw new Error("failed to save operation plan rules");
    }
    return { id: row.id };
  }

  // Scoped the same way `OperationsRepository.findMine` is: a foreign
  // operation id resolves to nothing here rather than another user's rules.
  async findByOperation(contemplatedOperationId: string): Promise<SavedPlanRules | null> {
    const [row] = await this.db
      .select()
      .from(operationPlanRules)
      .where(
        and(
          eq(operationPlanRules.contemplatedOperationId, contemplatedOperationId),
          eq(operationPlanRules.userId, this.userId),
        ),
      )
      .orderBy(desc(operationPlanRules.createdAt))
      .limit(1);

    return row ? toSavedPlanRules(row) : null;
  }

  async listMine(): Promise<SavedPlanRules[]> {
    const rows = await this.db
      .select()
      .from(operationPlanRules)
      .where(eq(operationPlanRules.userId, this.userId))
      .orderBy(desc(operationPlanRules.createdAt));

    return rows.map(toSavedPlanRules);
  }

  // Every plan rules row whose link already points at one of the given operations, scoped to
  // this user (ticket #381's nightly step reads these to know which operations to evaluate).
  async listByOperations(operationIds: readonly string[]): Promise<SavedPlanRules[]> {
    if (operationIds.length === 0) return [];
    const rows = await this.db
      .select()
      .from(operationPlanRules)
      .where(
        and(
          eq(operationPlanRules.userId, this.userId),
          inArray(operationPlanRules.operationId, [...operationIds]),
        ),
      );
    return rows.map(toSavedPlanRules);
  }

  // "Executei" links a plan to the real operation it became (ADR-0079 addendum, ticket #381),
  // once: scoped by this user's own id and by the plan not already carrying a link, so a
  // concurrent double-submit of the same execute action links at most one row.
  async linkOperation(
    contemplatedOperationId: string,
    operationId: string,
    executor: Executor = this.db,
  ): Promise<{ ok: true } | { ok: false }> {
    const rows = await executor
      .update(operationPlanRules)
      .set({ operationId })
      .where(
        and(
          eq(operationPlanRules.contemplatedOperationId, contemplatedOperationId),
          eq(operationPlanRules.userId, this.userId),
          isNull(operationPlanRules.operationId),
        ),
      )
      .returning({ id: operationPlanRules.id });
    return rows.length === 1 ? { ok: true } : { ok: false };
  }
}
