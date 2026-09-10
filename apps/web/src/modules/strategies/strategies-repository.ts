import { and, asc, desc, eq, ne } from "drizzle-orm";
import { z } from "zod";
import { strategyDefinitionSchema, type StrategyDefinition } from "@fetha/contracts";

import type { Database } from "@/db/client";
import { strategies, strategyVersions, strategyVisibilities } from "@/db/schema/strategies";
import { UserScopedRepository } from "@/lib/user-scoped-repository";

import { computeDefinitionDigest } from "./definition-digest";

export type StrategyVisibility = (typeof strategyVisibilities)[number];
const strategyVisibilitySchema = z.enum(strategyVisibilities);

type DbOrTx = Database | Parameters<Parameters<Database["transaction"]>[0]>[0];

export interface StrategySummary {
  id: string;
  name: string;
  visibility: StrategyVisibility;
  copiedFromStrategyId: string | null;
  latestVersionNumber: number;
  updatedAt: Date;
}

export interface StrategyVersionRecord {
  id: string;
  versionNumber: number;
  definition: StrategyDefinition;
  definitionDigest: string;
  createdAt: Date;
}

export interface StrategyWithVersions {
  id: string;
  name: string;
  userId: string;
  visibility: StrategyVisibility;
  copiedFromStrategyId: string | null;
  versions: StrategyVersionRecord[];
}

export interface SharedStrategyWithVersions {
  id: string;
  name: string;
  visibility: StrategyVisibility;
  copiedFromStrategyId: string | null;
  versions: StrategyVersionRecord[];
}

export class StrategyNotFoundError extends Error {
  constructor() {
    super("Strategy not found");
    this.name = "StrategyNotFoundError";
  }
}

export class StrategyNotSharedError extends Error {
  constructor() {
    super("Strategy is not shared");
    this.name = "StrategyNotSharedError";
  }
}

export class StrategiesRepository extends UserScopedRepository {
  async listMine(): Promise<StrategySummary[]> {
    const rows = await this.db
      .select({
        id: strategies.id,
        name: strategies.name,
        visibility: strategies.visibility,
        copiedFromStrategyId: strategies.copiedFromStrategyId,
        updatedAt: strategies.updatedAt,
      })
      .from(strategies)
      .where(eq(strategies.userId, this.userId))
      .orderBy(desc(strategies.updatedAt));

    return this.toSummaries(this.db, rows);
  }

  async listShared(): Promise<StrategySummary[]> {
    const rows = await this.db
      .select({
        id: strategies.id,
        name: strategies.name,
        visibility: strategies.visibility,
        copiedFromStrategyId: strategies.copiedFromStrategyId,
        updatedAt: strategies.updatedAt,
      })
      .from(strategies)
      .where(and(eq(strategies.visibility, "shared"), ne(strategies.userId, this.userId)))
      .orderBy(desc(strategies.updatedAt));

    return this.toSummaries(this.db, rows);
  }

  async findMine(strategyId: string): Promise<StrategyWithVersions> {
    const [row] = await this.db
      .select()
      .from(strategies)
      .where(and(eq(strategies.id, strategyId), eq(strategies.userId, this.userId)))
      .limit(1);
    if (!row) {
      throw new StrategyNotFoundError();
    }
    return this.withVersions(this.db, row);
  }

  async findShared(strategyId: string): Promise<SharedStrategyWithVersions> {
    const [row] = await this.db
      .select()
      .from(strategies)
      .where(and(eq(strategies.id, strategyId), eq(strategies.visibility, "shared")))
      .limit(1);
    if (!row) {
      throw new StrategyNotFoundError();
    }
    const withVersions = await this.withVersions(this.db, row);
    return {
      id: withVersions.id,
      name: withVersions.name,
      visibility: withVersions.visibility,
      copiedFromStrategyId: withVersions.copiedFromStrategyId,
      versions: withVersions.versions,
    };
  }

  async createWithVersion(definition: StrategyDefinition): Promise<StrategyWithVersions> {
    return this.db.transaction(async (tx) => {
      const [row] = await tx
        .insert(strategies)
        .values({ userId: this.userId, name: definition.name, visibility: "private" })
        .returning();
      if (!row) {
        throw new Error("failed to create strategy");
      }
      await this.insertVersion(tx, row.id, 1, definition);
      return this.withVersions(tx, row);
    });
  }

  async addVersion(
    strategyId: string,
    definition: StrategyDefinition,
  ): Promise<StrategyWithVersions> {
    return this.db.transaction(async (tx) => {
      const [row] = await tx
        .select()
        .from(strategies)
        .where(and(eq(strategies.id, strategyId), eq(strategies.userId, this.userId)))
        .for("update")
        .limit(1);
      if (!row) {
        throw new StrategyNotFoundError();
      }
      const latest = await this.latestVersion(tx, strategyId);
      const nextVersionNumber = (latest?.versionNumber ?? 0) + 1;
      await this.insertVersion(tx, strategyId, nextVersionNumber, definition);
      await tx
        .update(strategies)
        .set({ name: definition.name })
        .where(and(eq(strategies.id, strategyId), eq(strategies.userId, this.userId)));
      const [updated] = await tx
        .select()
        .from(strategies)
        .where(and(eq(strategies.id, strategyId), eq(strategies.userId, this.userId)))
        .limit(1);
      if (!updated) {
        throw new StrategyNotFoundError();
      }
      return this.withVersions(tx, updated);
    });
  }

  async setVisibility(strategyId: string, visibility: StrategyVisibility): Promise<void> {
    const result = await this.db
      .update(strategies)
      .set({ visibility })
      .where(and(eq(strategies.id, strategyId), eq(strategies.userId, this.userId)))
      .returning({ id: strategies.id });
    if (result.length === 0) {
      throw new StrategyNotFoundError();
    }
  }

  async copyShared(sourceStrategyId: string): Promise<StrategyWithVersions> {
    return this.db.transaction(async (tx) => {
      const [source] = await tx
        .select()
        .from(strategies)
        .where(eq(strategies.id, sourceStrategyId))
        .limit(1);
      const ownedByCaller = source?.userId === this.userId;
      if (!source || (source.visibility !== "shared" && !ownedByCaller)) {
        throw new StrategyNotFoundError();
      }
      if (source.visibility !== "shared") {
        throw new StrategyNotSharedError();
      }
      const latest = await this.latestVersion(tx, sourceStrategyId);
      if (!latest) {
        throw new StrategyNotFoundError();
      }

      const [copy] = await tx
        .insert(strategies)
        .values({
          userId: this.userId,
          name: source.name,
          visibility: "private",
          copiedFromStrategyId: source.id,
        })
        .returning();
      if (!copy) {
        throw new Error("failed to copy strategy");
      }
      await this.insertVersion(tx, copy.id, 1, latest.definition);
      return this.withVersions(tx, copy);
    });
  }

  private async latestVersion(
    db: DbOrTx,
    strategyId: string,
  ): Promise<StrategyVersionRecord | undefined> {
    const [row] = await db
      .select()
      .from(strategyVersions)
      .where(eq(strategyVersions.strategyId, strategyId))
      .orderBy(desc(strategyVersions.versionNumber))
      .limit(1);
    return row ? this.parseVersionRow(row) : undefined;
  }

  private parseVersionRow(row: {
    id: string;
    versionNumber: number;
    definition: unknown;
    definitionDigest: string;
    createdAt: Date;
  }): StrategyVersionRecord {
    return {
      id: row.id,
      versionNumber: row.versionNumber,
      definition: strategyDefinitionSchema.parse(row.definition),
      definitionDigest: row.definitionDigest,
      createdAt: row.createdAt,
    };
  }

  private async insertVersion(
    db: DbOrTx,
    strategyId: string,
    versionNumber: number,
    definition: StrategyDefinition,
  ): Promise<void> {
    await db.insert(strategyVersions).values({
      strategyId,
      versionNumber,
      definition,
      definitionDigest: computeDefinitionDigest(definition),
    });
  }

  private async toSummaries(
    db: DbOrTx,
    rows: {
      id: string;
      name: string;
      visibility: string;
      copiedFromStrategyId: string | null;
      updatedAt: Date;
    }[],
  ): Promise<StrategySummary[]> {
    const summaries: StrategySummary[] = [];
    for (const row of rows) {
      const latest = await this.latestVersion(db, row.id);
      summaries.push({
        id: row.id,
        name: row.name,
        visibility: strategyVisibilitySchema.parse(row.visibility),
        copiedFromStrategyId: row.copiedFromStrategyId,
        latestVersionNumber: latest?.versionNumber ?? 0,
        updatedAt: row.updatedAt,
      });
    }
    return summaries;
  }

  private async withVersions(
    db: DbOrTx,
    row: {
      id: string;
      name: string;
      userId: string;
      visibility: string;
      copiedFromStrategyId: string | null;
    },
  ): Promise<StrategyWithVersions> {
    const rows = await db
      .select()
      .from(strategyVersions)
      .where(eq(strategyVersions.strategyId, row.id))
      .orderBy(asc(strategyVersions.versionNumber));

    return {
      id: row.id,
      name: row.name,
      userId: row.userId,
      visibility: strategyVisibilitySchema.parse(row.visibility),
      copiedFromStrategyId: row.copiedFromStrategyId,
      versions: rows.map((r) => this.parseVersionRow(r)),
    };
  }
}
