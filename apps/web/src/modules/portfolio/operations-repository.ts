import { and, desc, eq } from "drizzle-orm";
import {
  centavosSchema,
  contemplatedLegSchema,
  type Centavos,
  type ContemplatedLeg,
} from "@fetha/contracts";

import { contemplatedOperations } from "./schema";
import { UserScopedRepository } from "@/lib/user-scoped-repository";

export interface SaveContemplatedOperationInput {
  structureId: string;
  underlying: string;
  legs: ContemplatedLeg[];
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

export class ContemplatedOperationNotFoundError extends Error {
  constructor() {
    super("Contemplated operation not found");
    this.name = "ContemplatedOperationNotFoundError";
  }
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

  // A foreign or missing operation id is a typed error, not a leak
  // (decisions module isolation test): scoped by this user's own id the
  // same way `listMine` is, so another user's operation id resolves to
  // nothing here.
  async findMine(id: string): Promise<ContemplatedOperation> {
    const [row] = await this.db
      .select()
      .from(contemplatedOperations)
      .where(
        and(eq(contemplatedOperations.id, id), eq(contemplatedOperations.userId, this.userId)),
      );

    if (!row) {
      throw new ContemplatedOperationNotFoundError();
    }

    return {
      id: row.id,
      structureId: row.structureId,
      underlying: row.underlying,
      legs: row.legs.map((leg) => contemplatedLegSchema.parse(leg)),
      session: row.session,
      netPremiumCentavos: centavosSchema.parse(row.netPremiumCentavos),
      maxLossCentavos:
        row.maxLossCentavos === null ? null : centavosSchema.parse(row.maxLossCentavos),
      maxGainCentavos:
        row.maxGainCentavos === null ? null : centavosSchema.parse(row.maxGainCentavos),
      breachedLimits: row.breachedLimits,
      createdAt: row.createdAt,
    };
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
      legs: row.legs.map((leg) => contemplatedLegSchema.parse(leg)),
      session: row.session,
      netPremiumCentavos: centavosSchema.parse(row.netPremiumCentavos),
      maxLossCentavos:
        row.maxLossCentavos === null ? null : centavosSchema.parse(row.maxLossCentavos),
      maxGainCentavos:
        row.maxGainCentavos === null ? null : centavosSchema.parse(row.maxGainCentavos),
      breachedLimits: row.breachedLimits,
      createdAt: row.createdAt,
    }));
  }
}
