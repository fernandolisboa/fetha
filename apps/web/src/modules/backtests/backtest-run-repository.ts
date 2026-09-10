import { and, desc, eq } from "drizzle-orm";
import type {
  Centavos,
  CostModel,
  RiskProfile,
  SessionDate,
  SizingRule,
  Ticker,
} from "@fetha/contracts";
import type { BacktestCheckpoint, BacktestRun, LimitMode } from "@fetha/engine";

import { backtestRuns, type backtestRunStatuses } from "@/db/schema/backtests";
import { UserScopedRepository } from "@/lib/user-scoped-repository";

export type BacktestRunStatus = (typeof backtestRunStatuses)[number];

export interface BacktestRunConfigInput {
  strategyId: string;
  strategyVersionId: string;
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

function toRecord(row: typeof backtestRuns.$inferSelect): BacktestRunRecord {
  return {
    id: row.id,
    userId: row.userId,
    strategyId: row.strategyId,
    strategyVersionId: row.strategyVersionId,
    universe: row.universe,
    period: { from: row.periodFrom, to: row.periodTo },
    initialCapital: row.initialCapital as Centavos,
    costModel: row.costModel,
    riskProfile: row.riskProfile,
    limits: row.limits,
    sizing: row.sizing ?? null,
    seed: row.seed,
    configDigest: row.configDigest,
    status: row.status,
    checkpoint: row.checkpoint ?? null,
    result: row.result ?? null,
    sessionsDone: row.sessionsDone,
    sessionsTotal: row.sessionsTotal,
    error: row.error,
    createdAt: row.createdAt,
    completedAt: row.completedAt,
  };
}

// User-scoped, per CLAUDE.md principle 5: every method filters by
// this.userId, and a run's own immutability once complete is additionally
// enforced by a database trigger (migration 0006_naive_grey_gargoyle.sql),
// not only by this class's own defensive checks.
export class BacktestRunRepository extends UserScopedRepository {
  async create(input: BacktestRunConfigInput): Promise<BacktestRunRecord> {
    const [row] = await this.db
      .insert(backtestRuns)
      .values({
        userId: this.userId,
        strategyId: input.strategyId,
        strategyVersionId: input.strategyVersionId,
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
      .where(and(eq(backtestRuns.strategyId, strategyId), eq(backtestRuns.userId, this.userId)))
      .orderBy(desc(backtestRuns.createdAt));
    return rows.map(toRecord);
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
    const [row] = await this.db
      .update(backtestRuns)
      .set(values)
      .where(and(eq(backtestRuns.id, id), eq(backtestRuns.userId, this.userId)))
      .returning();
    if (!row) {
      throw new BacktestRunNotFoundError();
    }
    return toRecord(row);
  }
}
