import { and, eq, sql } from "drizzle-orm";
import {
  backtestCheckpointSchema,
  backtestRunSchema,
  centavosSchema,
  costModelSchema,
  limitModeSchema,
  riskProfileSchema,
  sessionDateSchema,
  sizingRuleSchema,
  structureSchema,
  tickerSchema,
  type Centavos,
  type CostModel,
  type RiskProfile,
  type SessionDate,
  type SizingRule,
  type Structure,
  type Ticker,
} from "@fetha/contracts";
import type { BacktestCheckpoint, BacktestRun, LimitMode } from "@fetha/engine";
import { z } from "zod";

import { backtestRuns, type backtestRunStatuses } from "@/db/schema/backtests";
import { UserScopedRepository } from "@/lib/user-scoped-repository";

// The engine's own SimulatedOperation/LegSettlement discriminated unions
// correlate role, side and outcome literals in ways Zod cannot cheaply
// re-derive without duplicating engine internals contracts must not depend
// on (ADR-0013). backtestRunSchema validates every field's shape and every
// enum's known values at the repository edge; this cast bridges the
// validated shape to the engine's own exported vocabulary, the one every
// other consumer (ReportPanel, run-chunk) already speaks.
function asEngineCheckpoint(value: unknown): BacktestCheckpoint {
  return backtestCheckpointSchema.parse(value);
}
function asEngineRun(value: unknown): BacktestRun {
  return backtestRunSchema.parse(value) as unknown as BacktestRun;
}

export type BacktestRunStatus = (typeof backtestRunStatuses)[number];

export interface BacktestRunConfigInput {
  strategyId: string;
  strategyVersionId: string;
  structure: Structure;
  universe: Ticker[];
  period: { from: SessionDate; to: SessionDate };
  initialCapital: Centavos;
  costModel: CostModel;
  riskProfile: RiskProfile;
  limits: LimitMode;
  sizing: SizingRule | null;
  seed: number;
}

export interface BacktestRunRecord {
  id: string;
  userId: string;
  strategyId: string;
  strategyVersionId: string;
  structure: Structure;
  universe: Ticker[];
  period: { from: SessionDate; to: SessionDate };
  initialCapital: Centavos;
  costModel: CostModel;
  riskProfile: RiskProfile;
  limits: LimitMode;
  sizing: SizingRule | null;
  seed: number;
  configDigest: string | null;
  status: BacktestRunStatus;
  checkpoint: BacktestCheckpoint | null;
  result: BacktestRun | null;
  sessionsDone: number | null;
  sessionsTotal: number | null;
  error: string | null;
  createdAt: Date;
  completedAt: Date | null;
}

export class BacktestRunNotFoundError extends Error {
  constructor() {
    super("Backtest run not found");
    this.name = "BacktestRunNotFoundError";
  }
}

export class BacktestRunAlreadyCompleteError extends Error {
  constructor() {
    super("Backtest run is already complete");
    this.name = "BacktestRunAlreadyCompleteError";
  }
}

export class BacktestRunClaimError extends Error {
  constructor() {
    super("Backtest run could not be claimed: another call may already be running it");
    this.name = "BacktestRunClaimError";
  }
}

function isImmutabilityTriggerError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "P0001"
  );
}

const universeSchema = z.array(tickerSchema);
const periodSchema = z.object({ from: sessionDateSchema, to: sessionDateSchema });

function toRecord(row: typeof backtestRuns.$inferSelect): BacktestRunRecord {
  return {
    id: row.id,
    userId: row.userId,
    strategyId: row.strategyId,
    strategyVersionId: row.strategyVersionId,
    structure: structureSchema.parse(row.structure),
    universe: universeSchema.parse(row.universe),
    period: periodSchema.parse({ from: row.periodFrom, to: row.periodTo }),
    initialCapital: centavosSchema.parse(row.initialCapital),
    costModel: costModelSchema.parse(row.costModel),
    riskProfile: riskProfileSchema.parse(row.riskProfile),
    limits: limitModeSchema.parse(row.limits),
    sizing: row.sizing ? sizingRuleSchema.parse(row.sizing) : null,
    seed: row.seed,
    configDigest: row.configDigest,
    status: row.status,
    checkpoint: row.checkpoint ? asEngineCheckpoint(row.checkpoint) : null,
    result: row.result ? asEngineRun(row.result) : null,
    sessionsDone: row.sessionsDone,
    sessionsTotal: row.sessionsTotal,
    error: row.error,
    createdAt: row.createdAt,
    completedAt: row.completedAt,
  };
}

// User-scoped, per CLAUDE.md principle 5: every method filters by
// this.userId, and a run's own immutability once complete is additionally
// enforced by a database trigger, not only by this class's own defensive
// checks.
export class BacktestRunRepository extends UserScopedRepository {
  async create(input: BacktestRunConfigInput): Promise<BacktestRunRecord> {
    const [row] = await this.db
      .insert(backtestRuns)
      .values({
        userId: this.userId,
        strategyId: input.strategyId,
        strategyVersionId: input.strategyVersionId,
        structure: input.structure,
        universe: input.universe,
        periodFrom: input.period.from,
        periodTo: input.period.to,
        initialCapital: input.initialCapital,
        costModel: input.costModel,
        riskProfile: input.riskProfile,
        limits: input.limits,
        sizing: input.sizing,
        seed: input.seed,
        configDigest: "",
        status: "pending",
      })
      .returning();
    if (!row) {
      throw new Error("failed to create backtest run");
    }
    return toRecord(row);
  }

  async findMine(id: string): Promise<BacktestRunRecord> {
    const [row] = await this.db
      .select()
      .from(backtestRuns)
      .where(and(eq(backtestRuns.id, id), eq(backtestRuns.userId, this.userId)))
      .limit(1);
    if (!row) {
      throw new BacktestRunNotFoundError();
    }
    return toRecord(row);
  }

  async listMineForStrategy(strategyId: string): Promise<BacktestRunRecord[]> {
    const rows = await this.db
      .select()
      .from(backtestRuns)
      .where(and(eq(backtestRuns.strategyId, strategyId), eq(backtestRuns.userId, this.userId)));
    return rows.map(toRecord).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  // Claims the run for this call with a single conditional UPDATE instead
  // of a read-then-write: a concurrent second call for the same run finds
  // zero rows and fails with BacktestRunClaimError (mapped to 409 by the
  // route), rather than both calls racing a full engine chunk.
  async claim(id: string): Promise<BacktestRunRecord> {
    const [row] = await this.db
      .update(backtestRuns)
      .set({ status: "running" })
      .where(
        and(
          eq(backtestRuns.id, id),
          eq(backtestRuns.userId, this.userId),
          sql`${backtestRuns.status} in ('pending', 'paused')`,
        ),
      )
      .returning();
    if (!row) {
      const existing = await this.db
        .select({ id: backtestRuns.id })
        .from(backtestRuns)
        .where(and(eq(backtestRuns.id, id), eq(backtestRuns.userId, this.userId)))
        .limit(1);
      if (existing.length === 0) {
        throw new BacktestRunNotFoundError();
      }
      throw new BacktestRunClaimError();
    }
    return toRecord(row);
  }

  async saveProgress(
    id: string,
    progress: {
      status: "paused";
      checkpoint: BacktestCheckpoint;
      configDigest: string;
      sessionsDone: number;
      sessionsTotal: number;
    },
  ): Promise<BacktestRunRecord> {
    return this.guardedUpdate(id, {
      status: progress.status,
      checkpoint: progress.checkpoint,
      configDigest: progress.configDigest,
      sessionsDone: progress.sessionsDone,
      sessionsTotal: progress.sessionsTotal,
    });
  }

  async complete(
    id: string,
    outcome: { result: BacktestRun; configDigest: string; sessionsDone: number },
  ): Promise<BacktestRunRecord> {
    return this.guardedUpdate(id, {
      status: "complete",
      checkpoint: null,
      result: outcome.result,
      configDigest: outcome.configDigest,
      sessionsDone: outcome.sessionsDone,
      sessionsTotal: outcome.sessionsDone,
      completedAt: new Date(),
    });
  }

  async fail(id: string, error: string): Promise<BacktestRunRecord> {
    return this.guardedUpdate(id, { status: "failed", error });
  }

  private async guardedUpdate(
    id: string,
    values: Partial<typeof backtestRuns.$inferInsert>,
  ): Promise<BacktestRunRecord> {
    const existing = await this.findMine(id);
    if (existing.status === "complete") {
      throw new BacktestRunAlreadyCompleteError();
    }
    let row;
    try {
      [row] = await this.db
        .update(backtestRuns)
        .set(values)
        .where(and(eq(backtestRuns.id, id), eq(backtestRuns.userId, this.userId)))
        .returning();
    } catch (error) {
      // The immutability trigger (backtest_runs_no_update_once_complete)
      // raises P0001 when a concurrent call already completed the run
      // between the check above and this write: surfaced as the same
      // typed error the caller already handles as a 409, never a raw 500.
      if (isImmutabilityTriggerError(error)) {
        throw new BacktestRunAlreadyCompleteError();
      }
      throw error;
    }
    if (!row) {
      throw new BacktestRunNotFoundError();
    }
    return toRecord(row);
  }
}
