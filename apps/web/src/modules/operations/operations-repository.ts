import { desc, eq } from "drizzle-orm";
import { operationLegSchema, type Centavos, type OperationLeg } from "@fetha/contracts";

import { contemplatedOperations } from "@/db/schema/operations";
import { UserScopedRepository } from "@/lib/user-scoped-repository";

export interface SaveContemplatedOperationInput {
  structureId: string;
  underlying: string;
  legs: OperationLeg[];
  session: string;
  netPremiumCentavos: Centavos;
  maxLossCentavos: Centavos | null;
  maxGainCentavos: Centavos | null;
  breachedLimits: string[];
}

export interface ContemplatedOperation extends SaveContemplatedOperationInput {
  id: string;
  createdAt: Date;
}

export class OperationsRepository extends UserScopedRepository {
  async save(input: SaveContemplatedOperationInput): Promise<{ id: string }> {
    const [row] = await this.db
      .insert(contemplatedOperations)
      .values({
        userId: this.userId,
        structureId: input.structureId,
        underlying: input.underlying,
        legs: input.legs,
        session: input.session,
        netPremiumCentavos: input.netPremiumCentavos,
        maxLossCentavos: input.maxLossCentavos,
        maxGainCentavos: input.maxGainCentavos,
        breachedLimits: input.breachedLimits,
      })
      .returning({ id: contemplatedOperations.id });

    if (!row) {
      throw new Error("failed to save contemplated operation");
    }
    return { id: row.id };
  }

  async listMine(): Promise<ContemplatedOperation[]> {
    const rows = await this.db
      .select()
      .from(contemplatedOperations)
      .where(eq(contemplatedOperations.userId, this.userId))
      .orderBy(desc(contemplatedOperations.createdAt));

    return rows.map((row) => ({
      id: row.id,
      structureId: row.structureId,
      underlying: row.underlying,
      legs: row.legs.map((leg) => operationLegSchema.parse(leg)),
      session: row.session,
      netPremiumCentavos: row.netPremiumCentavos as Centavos,
      maxLossCentavos: row.maxLossCentavos as Centavos | null,
      maxGainCentavos: row.maxGainCentavos as Centavos | null,
      breachedLimits: row.breachedLimits,
      createdAt: row.createdAt,
    }));
  }
}
