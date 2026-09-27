import { and, desc, eq, inArray, lt, or, sql } from "drizzle-orm";
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

import { backtestRuns, type backtestRunStatuses } from "./schema";
import {
  ACTIVE_RUN_STATUSES,
  DISCARDED_RUN_ERROR,
  isActiveRun,
  isDiscardedRun,
  type ActiveRunStatus,
} from "./run-status";
import type { Database } from "@/db/client";
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
  walkForward: { windowSessions: number } | null;
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
  walkForward: { windowSessions: number } | null;
  seed: number;
  configDigest: string | null;
  status: BacktestRunStatus;
  checkpoint: BacktestCheckpoint | null;
  result: BacktestRun | null;
  sessionsDone: number | null;
  sessionsTotal: number | null;
  dataVersion: string | null;
  calendarVersion: string | null;
  error: string | null;
  createdAt: Date;
  completedAt: Date | null;
}

export interface BacktestRunSummary {
  id: string;
  strategyId: string;
  strategyVersionId: string;
  period: { from: SessionDate; to: SessionDate };
  createdAt: Date;
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

// route.ts raises `maxDuration` to 300s; a lease this much longer than that
// gives one invocation room to finish its own checkpoint write before a
// second caller could ever see it as stale, while still bounding how long a
// run a `maxDuration` kill or a Neon blip between the claim and the first
// checkpoint (round 1's own per-inner-call checkpointing exists to survive)
// can stay bricked in "running" with no path back to "pending" or "paused".
export const STALE_LEASE_MS = 360_000;

export class ActiveBacktestRunLimitError extends Error {
  constructor() {
    super("Too many backtest runs in progress");
    this.name = "ActiveBacktestRunLimitError";
  }
}

export type DiscardBacktestRunResult =
  { status: "discarded"; run: BacktestRunRecord } | { status: "not_discardable" };

export interface ActiveBacktestRunSummary {
  id: string;
  strategyId: string;
  strategyVersionId: string;
  status: ActiveRunStatus;
  period: { from: SessionDate; to: SessionDate };
  sessionsDone: number | null;
  sessionsTotal: number | null;
  createdAt: Date;
}

type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

export const MAX_ACTIVE_BACKTEST_RUNS = 2;

export class BacktestRunClaimError extends Error {
  constructor() {
    super("Backtest run could not be claimed: another call may already be running it");
    this.name = "BacktestRunClaimError";
  }
}

function hasP0001Code(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "P0001"
  );
}

// `drizzle-orm/neon-serverless` never throws the driver's own `pg`-shaped
// error (with `.code`) directly: every failed query is wrapped in its own
// `DrizzleQueryError`, whose message is `Failed query: ...` and which
// carries the real error as `.cause` (drizzle-orm/errors.js). Checking
// `error.code` alone matched only when the immutability check above this
// call's own pre-check (`guardedUpdate`'s `existing.status === "complete"`)
// happened to observe the row as already complete and short-circuited
// before ever reaching this UPDATE — round 3 item 8's own "not a pre-check
// that got lucky" concern, from the other end: CI's network latency to
// Neon made the trigger itself fire far more often than local runs did,
// and every one of those came back as this raw, unmapped `DrizzleQueryError`
// instead of `BacktestRunAlreadyCompleteError` (round 5 item 6). Bounded to
// two levels — the wrapper and its immediate cause — because that is the
// one shape this driver actually produces; walking an unbounded `.cause`
// chain would risk matching a `code: "P0001"` from somewhere the trigger
// never touched.
// Exported only for its own colocated unit test (backtest-run-repository.test.ts):
// the wrapped-cause detection this pins (round 5 item 6) is a pure function
// deterministically testable without racing two real database connections,
// unlike the trigger firing itself.
export function isImmutabilityTriggerError(error: unknown): boolean {
  if (hasP0001Code(error)) {
    return true;
  }
  const cause = error instanceof Error ? error.cause : undefined;
  return hasP0001Code(cause);
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
    walkForward:
      row.walkForwardWindowSessions === null
        ? null
        : { windowSessions: row.walkForwardWindowSessions },
    seed: row.seed,
    configDigest: row.configDigest,
    status: row.status,
    checkpoint: row.checkpoint ? asEngineCheckpoint(row.checkpoint) : null,
    result: row.result ? asEngineRun(row.result) : null,
    sessionsDone: row.sessionsDone,
    sessionsTotal: row.sessionsTotal,
    dataVersion: row.dataVersion,
    calendarVersion: row.calendarVersion,
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
  // Open registration lets anyone hold runs that each keep a 300 s function
  // busy per chunk (#147, docs/adr/0032). Every way into the active set
  // (create, and claim from "failed") counts under one per-user advisory
  // lock, so concurrent calls cannot both pass the cap.
  private async enforceActiveCap(tx: Transaction): Promise<void> {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`backtest_runs:${this.userId}`}, 0))`,
    );
    const [active] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(backtestRuns)
      .where(
        and(
          eq(backtestRuns.userId, this.userId),
          inArray(backtestRuns.status, ACTIVE_RUN_STATUSES),
        ),
      );
    if ((active?.count ?? 0) >= MAX_ACTIVE_BACKTEST_RUNS) {
      throw new ActiveBacktestRunLimitError();
    }
  }

  async create(input: BacktestRunConfigInput): Promise<BacktestRunRecord> {
    return this.db.transaction(async (tx) => {
      await this.enforceActiveCap(tx);
      const [row] = await tx
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
          walkForwardWindowSessions: input.walkForward?.windowSessions ?? null,
          seed: input.seed,
          configDigest: "",
          status: "pending",
        })
        .returning();
      if (!row) {
        throw new Error("failed to create backtest run");
      }
      return toRecord(row);
    });
  }

  // A user-initiated release valve for a run stuck in `pending`, `running`
  // or `paused` (ADR-0032's own residual, closed by ADR-0037): moves it
  // straight to `failed` with a fixed reason (DISCARDED_RUN_ERROR) through
  // the same `error` column `fail()` already writes, freeing the active
  // slot the run held without any schema change. `findMine` first gives
  // discard the same isolation and not-found behaviour as every other
  // per-id method (a run not owned by this user throws
  // BacktestRunNotFoundError); the conditional UPDATE that follows
  // re-checks status against ACTIVE_RUN_STATUSES, so a run a concurrent
  // complete() or fail() already moved to a terminal state between the two
  // reads is answered with the typed `not_discardable` result rather than
  // silently discarding a result the user has not seen.
  async discard(id: string): Promise<DiscardBacktestRunResult> {
    await this.findMine(id);
    const [row] = await this.db
      .update(backtestRuns)
      .set({ status: "failed", error: DISCARDED_RUN_ERROR })
      .where(
        and(
          eq(backtestRuns.id, id),
          eq(backtestRuns.userId, this.userId),
          inArray(backtestRuns.status, ACTIVE_RUN_STATUSES),
        ),
      )
      .returning();
    if (!row) {
      return { status: "not_discardable" };
    }
    return { status: "discarded", run: toRecord(row) };
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

  // A narrow, unparsed read of just the two columns a discard re-check
  // needs (run-chunk.ts's post-load re-check): findMine's full toRecord
  // re-parses every column (checkpoint, result, structure, universe...)
  // through Zod, work this hot-path check has no use for.
  async statusOf(id: string): Promise<{ status: BacktestRunStatus; error: string | null }> {
    const [row] = await this.db
      .select({ status: backtestRuns.status, error: backtestRuns.error })
      .from(backtestRuns)
      .where(and(eq(backtestRuns.id, id), eq(backtestRuns.userId, this.userId)))
      .limit(1);
    if (!row) {
      throw new BacktestRunNotFoundError();
    }
    return row;
  }

  async listMineForStrategy(strategyId: string): Promise<BacktestRunRecord[]> {
    const rows = await this.db
      .select()
      .from(backtestRuns)
      .where(and(eq(backtestRuns.strategyId, strategyId), eq(backtestRuns.userId, this.userId)));
    return rows.map(toRecord).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  // Every run still holding an active-cap slot, across every strategy: what
  // the "Em andamento" panel lists so a user refused at the cap does not
  // have to hunt through strategies one by one (ADR-0032's own residual).
  async listMineActive(): Promise<ActiveBacktestRunSummary[]> {
    const rows = await this.db
      .select({
        id: backtestRuns.id,
        strategyId: backtestRuns.strategyId,
        strategyVersionId: backtestRuns.strategyVersionId,
        periodFrom: backtestRuns.periodFrom,
        periodTo: backtestRuns.periodTo,
        status: backtestRuns.status,
        sessionsDone: backtestRuns.sessionsDone,
        sessionsTotal: backtestRuns.sessionsTotal,
        createdAt: backtestRuns.createdAt,
      })
      .from(backtestRuns)
      .where(
        and(
          eq(backtestRuns.userId, this.userId),
          inArray(backtestRuns.status, ACTIVE_RUN_STATUSES),
        ),
      )
      .orderBy(desc(backtestRuns.createdAt));
    return rows.flatMap((row) => {
      if (!isActiveRun(row)) {
        return [];
      }
      return [
        {
          id: row.id,
          strategyId: row.strategyId,
          strategyVersionId: row.strategyVersionId,
          status: row.status,
          period: periodSchema.parse({ from: row.periodFrom, to: row.periodTo }),
          sessionsDone: row.sessionsDone,
          sessionsTotal: row.sessionsTotal,
          createdAt: row.createdAt,
        },
      ];
    });
  }

  // Completed runs only, without their (large) result: what a comparison picker lists.
  async listMineCompleteSummaries(): Promise<BacktestRunSummary[]> {
    const rows = await this.db
      .select({
        id: backtestRuns.id,
        strategyId: backtestRuns.strategyId,
        strategyVersionId: backtestRuns.strategyVersionId,
        periodFrom: backtestRuns.periodFrom,
        periodTo: backtestRuns.periodTo,
        createdAt: backtestRuns.createdAt,
      })
      .from(backtestRuns)
      .where(and(eq(backtestRuns.userId, this.userId), eq(backtestRuns.status, "complete")))
      .orderBy(desc(backtestRuns.createdAt));
    return rows.map((row) => ({
      id: row.id,
      strategyId: row.strategyId,
      strategyVersionId: row.strategyVersionId,
      period: periodSchema.parse({ from: row.periodFrom, to: row.periodTo }),
      createdAt: row.createdAt,
    }));
  }

  // Ids that are not this user's, or not complete, are left out rather than failing the read.
  async findMineComplete(ids: readonly string[]): Promise<BacktestRunRecord[]> {
    if (ids.length === 0) return [];
    const rows = await this.db
      .select()
      .from(backtestRuns)
      .where(
        and(
          inArray(backtestRuns.id, [...ids]),
          eq(backtestRuns.userId, this.userId),
          eq(backtestRuns.status, "complete"),
        ),
      );
    const byId = new Map(rows.map((row) => [row.id, toRecord(row)]));
    return ids.flatMap((id) => byId.get(id) ?? []);
  }

  // Claims the run for this call with a single conditional UPDATE instead
  // of a read-then-write: a concurrent second call for the same run finds
  // zero rows and fails with BacktestRunClaimError (mapped to 409 by the
  // route), rather than both calls racing a full engine chunk. A "running"
  // row is also claimable once its own `updatedAt` is older than the stale
  // lease (round 2 item 2): nothing else ever moves a run out of "running"
  // except the invocation that set it, so without this a kill mid-chunk
  // would brick the run in "running" forever with a valid checkpoint and no
  // way back to it. "failed" is claimable too (round 2 item 12): fail() only
  // records the terminal state itself and never revokes it, so without this
  // a run that failed on a transient error (a Neon blip, a stale data
  // version between chunks) would have no way back into the loop even
  // though its checkpoint is still whatever the last successful inner call
  // left behind.
  async claim(id: string, now: Date = new Date()): Promise<BacktestRunRecord> {
    return this.db.transaction(async (tx) => {
      const [current] = await tx
        .select({ status: backtestRuns.status, error: backtestRuns.error })
        .from(backtestRuns)
        .where(and(eq(backtestRuns.id, id), eq(backtestRuns.userId, this.userId)))
        .limit(1);
      if (!current) {
        throw new BacktestRunNotFoundError();
      }
      if (current.status === "failed") {
        // Checked before enforceActiveCap, not after: a discarded run no
        // longer counts toward the cap ("failed" is not in
        // ACTIVE_RUN_STATUSES), so a user at the cap with a discarded run
        // among their other runs would otherwise have that cap check fail
        // with ActiveBacktestRunLimitError — the wrong reason. The real reason a
        // discarded run can never be claimed is that a discard is the
        // user's own choice, not a transient failure round 2 item 12 made
        // resumable, which is exactly what BacktestRunClaimError already
        // means for every other lost-claim race in this file.
        if (isDiscardedRun(current)) {
          throw new BacktestRunClaimError();
        }
        await this.enforceActiveCap(tx);
      }
      return this.claimRow(tx, id, now);
    });
  }

  private async claimRow(tx: Transaction, id: string, now: Date): Promise<BacktestRunRecord> {
    const staleCutoff = new Date(now.getTime() - STALE_LEASE_MS);
    const [row] = await tx
      .update(backtestRuns)
      // `error` is cleared, not just overwritten on the next `fail()`: a run
      // reclaimed from "failed" that goes on to complete must not carry its
      // previous failure message into a row that also asserts `status:
      // "complete"` (round 3 item 6).
      .set({ status: "running", error: null })
      .where(
        and(
          eq(backtestRuns.id, id),
          eq(backtestRuns.userId, this.userId),
          or(
            sql`${backtestRuns.status} in ('pending', 'paused')`,
            // A discarded run also carries `status = 'failed'`, the same
            // shape as a run that failed on its own, but it must never come
            // back into the active set this way: a discard is the user's
            // own choice, not a transient error round 2 item 12 made
            // resumable.
            sql`${backtestRuns.status} = 'failed' and ${backtestRuns.error} is distinct from ${DISCARDED_RUN_ERROR}`,
            and(eq(backtestRuns.status, "running"), lt(backtestRuns.updatedAt, staleCutoff)),
          ),
        ),
      )
      .returning();
    if (!row) {
      throw new BacktestRunClaimError();
    }
    return toRecord(row);
  }

  // Persists progress after one inner `engine.runBacktest` call without
  // changing status away from "running": a chunk that loops several inner
  // calls under a wall-clock budget (run-chunk.ts) calls this after each
  // one, so a process killed mid-loop by the platform's own timeout still
  // resumes from real progress instead of repeating the whole chunk.
  async saveCheckpoint(
    id: string,
    progress: {
      checkpoint: BacktestCheckpoint;
      configDigest: string;
      sessionsDone: number;
      sessionsTotal: number;
      dataVersion?: string | null;
      calendarVersion?: string | null;
    },
  ): Promise<BacktestRunRecord> {
    return this.guardedUpdate(id, {
      checkpoint: progress.checkpoint,
      configDigest: progress.configDigest,
      sessionsDone: progress.sessionsDone,
      sessionsTotal: progress.sessionsTotal,
      ...(progress.dataVersion !== undefined ? { dataVersion: progress.dataVersion } : {}),
      ...(progress.calendarVersion !== undefined
        ? { calendarVersion: progress.calendarVersion }
        : {}),
    });
  }

  async saveProgress(
    id: string,
    progress: {
      status: "paused";
      checkpoint: BacktestCheckpoint;
      configDigest: string;
      sessionsDone: number;
      sessionsTotal: number;
      dataVersion?: string | null;
      calendarVersion?: string | null;
    },
  ): Promise<BacktestRunRecord> {
    return this.guardedUpdate(id, {
      status: progress.status,
      checkpoint: progress.checkpoint,
      configDigest: progress.configDigest,
      sessionsDone: progress.sessionsDone,
      sessionsTotal: progress.sessionsTotal,
      ...(progress.dataVersion !== undefined ? { dataVersion: progress.dataVersion } : {}),
      ...(progress.calendarVersion !== undefined
        ? { calendarVersion: progress.calendarVersion }
        : {}),
    });
  }

  async complete(
    id: string,
    outcome: {
      result: BacktestRun;
      configDigest: string;
      sessionsDone: number;
      dataVersion?: string | null;
      calendarVersion?: string | null;
    },
  ): Promise<BacktestRunRecord> {
    return this.guardedUpdate(id, {
      status: "complete",
      checkpoint: null,
      result: outcome.result,
      configDigest: outcome.configDigest,
      sessionsDone: outcome.sessionsDone,
      sessionsTotal: outcome.sessionsDone,
      ...(outcome.dataVersion !== undefined ? { dataVersion: outcome.dataVersion } : {}),
      ...(outcome.calendarVersion !== undefined
        ? { calendarVersion: outcome.calendarVersion }
        : {}),
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
    // A discard can land between a chunk's own claim and this write (still
    // "running" at run-chunk.ts's own re-check, discarded by the time this
    // call runs): run-chunk.ts's post-load re-check narrows that window but
    // cannot close it, so this is the last place that can. The WHERE clause
    // below closes the identical race the pre-check here cannot (the same
    // shape the immutability trigger closes for "complete"), so a chunk
    // finishing after a discard raises the same typed error a lost claim
    // already does instead of reviving the run. `IS DISTINCT FROM`, not
    // `<>`/`!=`, on both sides of the OR: a `failed` row with a `NULL`
    // error (never written by this class, but not schema-impossible) must
    // stay writable, and `<>` against `discarded` on a `NULL` column
    // evaluates to `NULL`, which Postgres treats as excluding the row from
    // `WHERE` — silently as unreachable as if it really were discarded.
    if (isDiscardedRun(existing)) {
      throw new BacktestRunClaimError();
    }
    let row;
    try {
      [row] = await this.db
        .update(backtestRuns)
        .set(values)
        .where(
          and(
            eq(backtestRuns.id, id),
            eq(backtestRuns.userId, this.userId),
            sql`(${backtestRuns.status} <> 'failed' or ${backtestRuns.error} is distinct from ${DISCARDED_RUN_ERROR})`,
          ),
        )
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
      throw new BacktestRunClaimError();
    }
    return toRecord(row);
  }
}
