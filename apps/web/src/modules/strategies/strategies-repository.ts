import { and, asc, desc, eq, ilike, isNotNull, isNull, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { strategyDefinitionSchema, type StrategyDefinition } from "@fetha/contracts";

import type { Database, Transaction } from "@/db/client";
import { strategies, strategyVersions, strategyVisibilities } from "./schema";
import { UserScopedRepository } from "@/lib/user-scoped-repository";

import { computeDefinitionDigest } from "./definition-digest";

export type StrategyVisibility = (typeof strategyVisibilities)[number];
const strategyVisibilitySchema = z.enum(strategyVisibilities);

type DbOrTx = Database | Transaction;

export interface StrategySummary {
  id: string;
  name: string;
  visibility: StrategyVisibility;
  copiedFromStrategyId: string | null;
  latestVersionNumber: number;
  updatedAt: Date;
}

export interface StrategySearchResult {
  id: string;
  name: string;
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
  active: boolean;
  archivedAt: Date | null;
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

export class StrategyLimitReachedError extends Error {
  constructor() {
    super("Strategy limit reached");
    this.name = "StrategyLimitReachedError";
  }
}

export class StrategyVersionLimitError extends Error {
  constructor() {
    super("Strategy version limit reached");
    this.name = "StrategyVersionLimitError";
  }
}

// docs/adr/0043: an archived strategy is read-only until unarchived.
export class StrategyArchivedError extends Error {
  constructor() {
    super("Strategy is archived");
    this.name = "StrategyArchivedError";
  }
}

// Bounds an unbounded edit loop on one strategy (#147, docs/adr/0032), well
// above real use; a new strategy starts its own count.
export const MAX_VERSIONS_PER_STRATEGY = 100;

// A generous ceiling, not a plan limit (CLAUDE.md: no fees, no plans): it
// exists only to bound an unbounded write loop (a bug or a scripted abuser),
// not to constrain the owner's real usage.
export const MAX_STRATEGIES_PER_USER = 200;

export class StrategiesRepository extends UserScopedRepository {
  // Every way into a user's non-archived strategy set (create, copy,
  // unarchive) counts under one per-user advisory lock, same pattern as
  // BacktestRunRepository.enforceActiveCap (#147, docs/adr/0032): a
  // list-then-insert outside a lock lets two concurrent creates at
  // cap-1 both pass (#160). Archived strategies do not count
  // (docs/adr/0043): archiving is the way out of the cap.
  private async enforceStrategyCap(tx: Transaction): Promise<void> {
    await this.lockUserScope(tx, "strategies");
    const [mine] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(strategies)
      .where(and(eq(strategies.userId, this.userId), isNull(strategies.archivedAt)));
    if ((mine?.count ?? 0) >= MAX_STRATEGIES_PER_USER) {
      throw new StrategyLimitReachedError();
    }
  }

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
      .where(and(eq(strategies.userId, this.userId), isNull(strategies.archivedAt)))
      .orderBy(desc(strategies.updatedAt));

    return this.toSummaries(this.db, rows);
  }

  async listMineArchived(): Promise<StrategySummary[]> {
    const rows = await this.db
      .select({
        id: strategies.id,
        name: strategies.name,
        visibility: strategies.visibility,
        copiedFromStrategyId: strategies.copiedFromStrategyId,
        updatedAt: strategies.updatedAt,
      })
      .from(strategies)
      .where(and(eq(strategies.userId, this.userId), isNotNull(strategies.archivedAt)))
      .orderBy(desc(strategies.updatedAt));

    return this.toSummaries(this.db, rows);
  }

  // An archived shared strategy is no longer offered to others (docs/adr/0043):
  // its visibility value is kept, but it stops appearing here and copyShared
  // refuses it, the same way it stops counting toward the owner's own cap.
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
      .where(
        and(
          eq(strategies.visibility, "shared"),
          ne(strategies.userId, this.userId),
          isNull(strategies.archivedAt),
        ),
      )
      .orderBy(desc(strategies.updatedAt));

    return this.toSummaries(this.db, rows);
  }

  // The command palette's strategy source (#233): a case-insensitive
  // substring match on the caller's own, non-archived strategies. The
  // query is user input reaching `ILIKE`, so its own `%`, `_` and `\` are
  // escaped with a leading backslash (Postgres's default `ILIKE` escape
  // character) before being wrapped in wildcards, the same way the ticker
  // in the query the caller cannot control is never trusted verbatim
  // elsewhere in this module.
  async searchMine(query: string, limit: number): Promise<StrategySearchResult[]> {
    const escaped = query.replace(/[\\%_]/g, (character) => `\\${character}`);
    const pattern = `%${escaped}%`;
    const rows = await this.db
      .select({ id: strategies.id, name: strategies.name })
      .from(strategies)
      .where(
        and(
          eq(strategies.userId, this.userId),
          isNull(strategies.archivedAt),
          ilike(strategies.name, pattern),
        ),
      )
      .orderBy(desc(strategies.updatedAt))
      .limit(limit);
    return rows;
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
      .where(
        and(
          eq(strategies.id, strategyId),
          eq(strategies.visibility, "shared"),
          isNull(strategies.archivedAt),
        ),
      )
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
      await this.enforceStrategyCap(tx);
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
      if (row.archivedAt) {
        throw new StrategyArchivedError();
      }
      const latest = await this.latestVersion(tx, strategyId);
      const nextVersionNumber = (latest?.versionNumber ?? 0) + 1;
      if (nextVersionNumber > MAX_VERSIONS_PER_STRATEGY) {
        throw new StrategyVersionLimitError();
      }
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

  async setActive(strategyId: string, active: boolean): Promise<void> {
    await this.updateOwned(strategyId, { active }, active);
  }

  // The evaluation step's own read (#19): every strategy this user activated
  // whose latest version's timeframe is daily (`D1`), with the version it
  // must evaluate — always the latest one, versions being immutable
  // (UBIQUITOUS_LANGUAGE.md "Strategy version").
  async listActiveDaily(): Promise<{ strategyId: string; version: StrategyVersionRecord }[]> {
    const rows = await this.db
      .select({ id: strategies.id })
      .from(strategies)
      .where(
        and(
          eq(strategies.userId, this.userId),
          eq(strategies.active, true),
          isNull(strategies.archivedAt),
        ),
      );

    const result: { strategyId: string; version: StrategyVersionRecord }[] = [];
    for (const row of rows) {
      const version = await this.latestVersion(this.db, row.id);
      if (version && version.definition.timeframe === "D1") {
        result.push({ strategyId: row.id, version });
      }
    }
    return result;
  }

  // A single strategy version by id, scoped by this user through the
  // strategy it belongs to (#29's decision-scoring job: `decisions.strategy_version_id`
  // never crosses a tenant boundary since only the owner's own strategy
  // could have produced the signal a decision answered, but this join makes
  // that a query-level guarantee rather than an assumption). Returns null
  // for a version that does not exist or belongs to another user, never a
  // thrown not-found — the caller treats a vanished strategy version as
  // "cannot score this decision" the same way `unknown_structure` is
  // handled in `evaluateSignalsForSession`.
  async findVersionForScoring(strategyVersionId: string): Promise<StrategyVersionRecord | null> {
    const [row] = await this.db
      .select({
        id: strategyVersions.id,
        versionNumber: strategyVersions.versionNumber,
        definition: strategyVersions.definition,
        definitionDigest: strategyVersions.definitionDigest,
        createdAt: strategyVersions.createdAt,
      })
      .from(strategyVersions)
      .innerJoin(strategies, eq(strategies.id, strategyVersions.strategyId))
      .where(and(eq(strategyVersions.id, strategyVersionId), eq(strategies.userId, this.userId)));

    return row ? this.parseVersionRow(row) : null;
  }

  async setVisibility(strategyId: string, visibility: StrategyVisibility): Promise<void> {
    await this.updateOwned(strategyId, { visibility }, visibility === "shared");
  }

  // Deactivates too (docs/adr/0043): an archived strategy stops producing
  // signals the same way any other deactivation does. Idempotent: archiving
  // an already-archived strategy re-stamps `archivedAt` rather than
  // refusing.
  async archive(strategyId: string): Promise<void> {
    const result = await this.db
      .update(strategies)
      .set({ archivedAt: new Date(), active: false })
      .where(and(eq(strategies.id, strategyId), eq(strategies.userId, this.userId)))
      .returning({ id: strategies.id });
    if (result.length === 0) {
      throw new StrategyNotFoundError();
    }
  }

  // Clears `archivedAt` under the same per-user cap lock as create/copy
  // (docs/adr/0043): unarchiving at 200 non-archived strategies is refused
  // the same way a 201st create is. Never re-activates: the strategy comes
  // back exactly as inactive as it was left, evaluated only once the user
  // turns it on again. The per-user lock comes before the row lock, the same
  // order copyShared takes them, so the two cannot deadlock. Idempotent: an
  // already-unarchived strategy is left alone rather than counted against
  // the cap it already sits in.
  async unarchive(strategyId: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      await this.lockUserScope(tx, "strategies");
      const [row] = await tx
        .select({ archivedAt: strategies.archivedAt })
        .from(strategies)
        .where(and(eq(strategies.id, strategyId), eq(strategies.userId, this.userId)))
        .for("update")
        .limit(1);
      if (!row) {
        throw new StrategyNotFoundError();
      }
      if (!row.archivedAt) return;
      await this.enforceStrategyCap(tx);
      await tx
        .update(strategies)
        .set({ archivedAt: null })
        .where(and(eq(strategies.id, strategyId), eq(strategies.userId, this.userId)));
    });
  }

  async copyShared(sourceStrategyId: string): Promise<StrategyWithVersions> {
    return this.db.transaction(async (tx) => {
      const [source] = await tx
        .select()
        .from(strategies)
        .where(eq(strategies.id, sourceStrategyId))
        .limit(1);
      const ownedByCaller = source?.userId === this.userId;
      if (
        !source ||
        (source.visibility !== "shared" && !ownedByCaller) ||
        (source.archivedAt && !ownedByCaller)
      ) {
        // An archived shared strategy is no longer offered to others
        // (docs/adr/0043): the same not-found another user gets for a
        // private one, no existence oracle either way.
        throw new StrategyNotFoundError();
      }
      if (source.visibility !== "shared") {
        throw new StrategyNotSharedError();
      }
      if (source.archivedAt) {
        throw new StrategyArchivedError();
      }
      const latest = await this.latestVersion(tx, sourceStrategyId);
      if (!latest) {
        throw new StrategyNotFoundError();
      }

      await this.enforceStrategyCap(tx);

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

  // The archived check sits in the UPDATE's own WHERE, so an archive landing
  // between a read and this write cannot leave an archived strategy active
  // or shared.
  private async updateOwned(
    strategyId: string,
    values: { active?: boolean; visibility?: StrategyVisibility },
    refuseIfArchived: boolean,
  ): Promise<void> {
    const result = await this.db
      .update(strategies)
      .set(values)
      .where(
        and(
          eq(strategies.id, strategyId),
          eq(strategies.userId, this.userId),
          refuseIfArchived ? isNull(strategies.archivedAt) : undefined,
        ),
      )
      .returning({ id: strategies.id });
    if (result.length > 0) {
      return;
    }
    const [row] = await this.db
      .select({ id: strategies.id })
      .from(strategies)
      .where(and(eq(strategies.id, strategyId), eq(strategies.userId, this.userId)))
      .limit(1);
    throw row ? new StrategyArchivedError() : new StrategyNotFoundError();
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
      active: boolean;
      archivedAt: Date | null;
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
      active: row.active,
      archivedAt: row.archivedAt,
      versions: rows.map((r) => this.parseVersionRow(r)),
    };
  }
}
