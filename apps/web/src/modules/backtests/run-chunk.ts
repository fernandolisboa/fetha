import type { Structure } from "@fetha/contracts";
import {
  engine,
  type BacktestCheckpoint,
  type BacktestConfig,
  type BacktestProgress,
  type EngineErrorCode,
} from "@fetha/engine";

import type { Database } from "@/db/client";
import type { ScopedUser } from "@/lib/user-scoped-repository";
import { loadMarketView } from "@/modules/market-data";
import { StrategiesRepository, StructuresRepository } from "@/modules/strategies";

import { BacktestRunRepository, type BacktestRunRecord } from "./backtest-run-repository";

// A generous total-session ceiling under a raised `maxDuration`: the route
// handler leans on this default; the chunk-invariance integration test
// overrides it with a small value to force the same run across several
// outer calls without needing hundreds of ingested sessions.
export const DEFAULT_SESSION_BUDGET = 250;

// The size of each *inner* `engine.runBacktest` call inside one outer
// `runBacktestChunk` call: small enough that the checkpoint persisted after
// it (saveCheckpoint, below) is never far behind, so a process the platform
// kills mid-chunk still resumes from real progress instead of repeating the
// whole chunk from its start.
export const DEFAULT_INNER_STEP_SESSIONS = 25;

// route.ts raises `maxDuration` to 300s; this budget stays comfortably
// under it, leaving headroom for the DB round trip around each inner call,
// so the platform's own timeout — not this budget — is never what kills a
// chunk's progress.
export const DEFAULT_WALL_CLOCK_BUDGET_MS = 240_000;

export class StrategyVersionNotFoundError extends Error {
  constructor() {
    super("Strategy version not found");
    this.name = "StrategyVersionNotFoundError";
  }
}

export class StructureNotFoundError extends Error {
  constructor() {
    super("Structure not found");
    this.name = "StructureNotFoundError";
  }
}

export type BacktestChunkOutcome =
  | { status: "paused"; run: BacktestRunRecord; sessionsDone: number; sessionsTotal: number }
  | { status: "complete"; run: BacktestRunRecord }
  | { status: "failed"; error: string };

async function loadStrategyDefinition(
  db: Database,
  user: ScopedUser,
  strategyId: string,
  strategyVersionId: string,
): Promise<{ definition: BacktestConfig["strategy"]["definition"] }> {
  const strategy = await new StrategiesRepository(db, user).findMine(strategyId);
  const version = strategy.versions.find((candidate) => candidate.id === strategyVersionId);
  if (!version) {
    throw new StrategyVersionNotFoundError();
  }
  return { definition: version.definition };
}

export async function resolveStructure(db: Database, structureId: string): Promise<Structure> {
  const structures = await new StructuresRepository(db).listAll();
  const structure = structures.find((candidate) => candidate.id === structureId);
  if (!structure) {
    throw new StructureNotFoundError();
  }
  return structure;
}

export interface RunBacktestChunkOptions {
  maxSessions?: number;
  innerStepSessions?: number;
  wallClockBudgetMs?: number;
  now?: () => number;
}

// Runs one budgeted chunk of a backtest, looping several small inner
// `engine.runBacktest` calls under a wall-clock deadline (not just a
// session count) and persisting a checkpoint after each one: a chunk large
// enough to threaten the platform's `maxDuration` still makes progress
// instead of dying with nothing saved and repeating forever on retry
// (round 1 item 19). The MarketView's own `dataVersion` is stamped on the
// run at its first chunk and compared on every resume, so a candle or
// calendar revision between chunks fails the run rather than silently
// mixing two datasets into one immutable result (round 1 item 21).
export async function runBacktestChunk(
  db: Database,
  user: ScopedUser,
  runId: string,
  options: RunBacktestChunkOptions = {},
): Promise<BacktestChunkOutcome> {
  const repository = new BacktestRunRepository(db, user);
  const claimed = await repository.findMine(runId);

  if (claimed.status === "complete") {
    return { status: "complete", run: claimed };
  }

  const run = await repository.claim(runId);

  const { definition } = await loadStrategyDefinition(
    db,
    user,
    run.strategyId,
    run.strategyVersionId,
  );

  const strategy: BacktestConfig["strategy"] = {
    id: run.strategyVersionId,
    definition,
    structure: run.structure,
  };

  const config: BacktestConfig = {
    strategy,
    universe: run.universe,
    period: run.period,
    initialCapital: run.initialCapital,
    costModel: run.costModel,
    riskProfile: run.riskProfile,
    limits: run.limits,
    sizing: run.sizing,
    walkForward: null,
    seed: run.seed,
  };

  const view = await loadMarketView(db, {
    strategy,
    universe: run.universe,
    period: run.period,
  });

  if (run.dataVersion && view.dataVersion && run.dataVersion !== view.dataVersion) {
    const message = "data_version_changed";
    await repository.fail(runId, message);
    return { status: "failed", error: message };
  }
  const dataVersion = run.dataVersion ?? view.dataVersion ?? null;

  const now = options.now ?? Date.now;
  const deadline = now() + (options.wallClockBudgetMs ?? DEFAULT_WALL_CLOCK_BUDGET_MS);
  const innerStep = options.innerStepSessions ?? DEFAULT_INNER_STEP_SESSIONS;
  const sessionBudget = options.maxSessions ?? DEFAULT_SESSION_BUDGET;

  let checkpoint: BacktestCheckpoint | null = run.checkpoint;
  let sessionsUsed = 0;
  let lastPaused: Extract<BacktestProgress, { status: "paused" }> | null = null;

  while (sessionsUsed < sessionBudget) {
    const step = Math.min(innerStep, sessionBudget - sessionsUsed);
    const result = await engine.runBacktest({
      view,
      config,
      ...(checkpoint ? { resume: checkpoint } : {}),
      maxSessions: step,
    });

    if (!result.ok) {
      if (result.error.code === "checkpoint_mismatch" && checkpoint) {
        // An engine-version or schema bump between chunks: the checkpoint
        // this loop holds can never resume against the current engine, but
        // a full restart from session zero against the same immutable
        // config still produces the same deterministic result (ADR-0004),
        // so this is recoverable rather than terminal.
        const restarted = await engine.runBacktest({
          view,
          config,
          maxSessions: sessionBudget - sessionsUsed,
        });
        if (restarted.ok) {
          return persistProgress(repository, runId, restarted.value, dataVersion);
        }
        const message = describeEngineError(restarted.error);
        await repository.fail(runId, message);
        return { status: "failed", error: message };
      }
      const message = describeEngineError(result.error);
      await repository.fail(runId, message);
      return { status: "failed", error: message };
    }

    if (result.value.status === "complete") {
      return persistProgress(repository, runId, result.value, dataVersion);
    }

    // Persisted immediately, status left "running": a process the platform
    // kills right after this write still resumes from here on retry.
    await repository.saveCheckpoint(runId, {
      checkpoint: result.value.checkpoint,
      configDigest: result.value.checkpoint.configDigest,
      sessionsDone: result.value.sessionsDone,
      sessionsTotal: result.value.sessionsTotal,
      dataVersion,
    });
    checkpoint = result.value.checkpoint;
    lastPaused = result.value;
    sessionsUsed += step;

    if (now() >= deadline) break;
  }

  if (!lastPaused) {
    throw new Error("runBacktestChunk: no progress was made (maxSessions must be positive)");
  }

  const saved = await repository.saveProgress(runId, {
    status: "paused",
    checkpoint: lastPaused.checkpoint,
    configDigest: lastPaused.checkpoint.configDigest,
    sessionsDone: lastPaused.sessionsDone,
    sessionsTotal: lastPaused.sessionsTotal,
    dataVersion,
  });
  return {
    status: "paused",
    run: saved,
    sessionsDone: lastPaused.sessionsDone,
    sessionsTotal: lastPaused.sessionsTotal,
  };
}

async function persistProgress(
  repository: BacktestRunRepository,
  runId: string,
  value: BacktestProgress,
  dataVersion: string | null,
): Promise<BacktestChunkOutcome> {
  if (value.status === "paused") {
    const saved = await repository.saveProgress(runId, {
      status: "paused",
      checkpoint: value.checkpoint,
      configDigest: value.checkpoint.configDigest,
      sessionsDone: value.sessionsDone,
      sessionsTotal: value.sessionsTotal,
      dataVersion,
    });
    return {
      status: "paused",
      run: saved,
      sessionsDone: value.sessionsDone,
      sessionsTotal: value.sessionsTotal,
    };
  }

  const saved = await repository.complete(runId, {
    result: value.run,
    configDigest: value.run.configDigest,
    sessionsDone: value.run.metrics.sessions,
    dataVersion,
  });
  return { status: "complete", run: saved };
}

// The raw engine code is what the "error" column stores; the report and
// button translate it to pt-BR at display time (strings.ts
// engineErrorMessage), the same split NoteCode already uses.
function describeEngineError(error: { code: EngineErrorCode }): string {
  return error.code;
}
