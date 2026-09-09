import { and, asc, desc, eq } from "drizzle-orm";
import type { StrategyDefinition } from "@fetha/contracts";

import { strategies, strategyVersions, type strategyVisibilities } from "@/db/schema/strategies";
import { UserScopedRepository } from "@/lib/user-scoped-repository";

import { computeConfigDigest } from "./config-digest";

export type StrategyVisibility = (typeof strategyVisibilities)[number];

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
  configDigest: string;
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

    const summaries: StrategySummary[] = [];
    for (const row of rows) {
      const latest = await this.latestVersion(row.id);
      summaries.push({
        id: row.id,
        name: row.name,
        visibility: row.visibility as StrategyVisibility,
        copiedFromStrategyId: row.copiedFromStrategyId,
        latestVersionNumber: latest?.versionNumber ?? 0,
        updatedAt: row.updatedAt,
      });
    }
    return summaries;
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
      .where(eq(strategies.visibility, "shared"))
      .orderBy(desc(strategies.updatedAt));

    const summaries: StrategySummary[] = [];
    for (const row of rows) {
      const latest = await this.latestVersion(row.id);
      summaries.push({
        id: row.id,
        name: row.name,
        visibility: row.visibility as StrategyVisibility,
        copiedFromStrategyId: row.copiedFromStrategyId,
        latestVersionNumber: latest?.versionNumber ?? 0,
        updatedAt: row.updatedAt,
      });
    }
    return summaries;
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
    return this.withVersions(row);
  }

  async findShared(strategyId: string): Promise<StrategyWithVersions> {
    const [row] = await this.db
      .select()
      .from(strategies)
      .where(and(eq(strategies.id, strategyId), eq(strategies.visibility, "shared")))
      .limit(1);
    if (!row) {
      throw new StrategyNotFoundError();
    }
    return this.withVersions(row);
  }

  async createWithVersion(
    name: string,
    definition: StrategyDefinition,
  ): Promise<StrategyWithVersions> {
    const [row] = await this.db
      .insert(strategies)
      .values({ userId: this.userId, name, visibility: "private" })
      .returning();
    if (!row) {
      throw new Error("failed to create strategy");
    }
    await this.insertVersion(row.id, 1, definition);
    return this.withVersions(row);
  }

  async addVersion(
    strategyId: string,
    definition: StrategyDefinition,
  ): Promise<StrategyWithVersions> {
    const [row] = await this.db
      .select()
      .from(strategies)
      .where(and(eq(strategies.id, strategyId), eq(strategies.userId, this.userId)))
      .limit(1);
    if (!row) {
      throw new StrategyNotFoundError();
    }
    const latest = await this.latestVersion(strategyId);
    const nextVersionNumber = (latest?.versionNumber ?? 0) + 1;
    await this.insertVersion(strategyId, nextVersionNumber, definition);
    await this.db
      .update(strategies)
      .set({ name: definition.name })
      .where(eq(strategies.id, strategyId));
    return this.findMine(strategyId);
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
    const [source] = await this.db
      .select()
      .from(strategies)
      .where(eq(strategies.id, sourceStrategyId))
      .limit(1);
    if (!source) {
      throw new StrategyNotFoundError();
    }
    if (source.visibility !== "shared") {
      throw new StrategyNotSharedError();
    }
    const latest = await this.latestVersion(sourceStrategyId);
    if (!latest) {
      throw new StrategyNotFoundError();
    }

    const [copy] = await this.db
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
    await this.insertVersion(copy.id, 1, latest.definition);
    return this.withVersions(copy);
  }

  private async latestVersion(strategyId: string): Promise<StrategyVersionRecord | undefined> {
    const [row] = await this.db
      .select()
      .from(strategyVersions)
      .where(eq(strategyVersions.strategyId, strategyId))
      .orderBy(desc(strategyVersions.versionNumber))
      .limit(1);
    return row;
  }

  private async insertVersion(
    strategyId: string,
    versionNumber: number,
    definition: StrategyDefinition,
  ): Promise<void> {
    await this.db.insert(strategyVersions).values({
      strategyId,
      versionNumber,
      definition,
      configDigest: computeConfigDigest(definition),
    });
  }

  private async withVersions(row: {
    id: string;
    name: string;
    userId: string;
    visibility: string;
    copiedFromStrategyId: string | null;
  }): Promise<StrategyWithVersions> {
    const versions = await this.db
      .select()
      .from(strategyVersions)
      .where(eq(strategyVersions.strategyId, row.id))
      .orderBy(asc(strategyVersions.versionNumber));

    return {
      id: row.id,
      name: row.name,
      userId: row.userId,
      visibility: row.visibility as StrategyVisibility,
      copiedFromStrategyId: row.copiedFromStrategyId,
      versions,
    };
  }
}
