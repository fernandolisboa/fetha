import { and, desc, eq } from "drizzle-orm";
import { planRulesSchema, type PlanRules } from "@fetha/contracts";

import { UserScopedRepository } from "@/lib/user-scoped-repository";

import { operationPlanRules } from "./schema";

export interface SavePlanRulesInput {
  contemplatedOperationId: string;
  recipeId: string;
  rules: PlanRules;
}

export interface SavedPlanRules extends SavePlanRulesInput {
  id: string;
  createdAt: Date;
}

export class PlanRulesRepository extends UserScopedRepository {
  async save(input: SavePlanRulesInput): Promise<{ id: string }> {
    const [row] = await this.db
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

    if (!row) return null;
    return {
      id: row.id,
      contemplatedOperationId: row.contemplatedOperationId,
      recipeId: row.recipeId,
      rules: planRulesSchema.parse(row.rules),
      createdAt: row.createdAt,
    };
  }

  async listMine(): Promise<SavedPlanRules[]> {
    const rows = await this.db
      .select()
      .from(operationPlanRules)
      .where(eq(operationPlanRules.userId, this.userId))
      .orderBy(desc(operationPlanRules.createdAt));

    return rows.map((row) => ({
      id: row.id,
      contemplatedOperationId: row.contemplatedOperationId,
      recipeId: row.recipeId,
      rules: planRulesSchema.parse(row.rules),
      createdAt: row.createdAt,
    }));
  }
}
