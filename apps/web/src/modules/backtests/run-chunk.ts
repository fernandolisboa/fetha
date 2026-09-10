import type { Structure } from "@fetha/contracts";
import {
  engine,
  type BacktestConfig,
  type BacktestProgress,
  type EngineErrorCode,
} from "@fetha/engine";

import type { Database } from "@/db/client";
import type { ScopedUser } from "@/lib/user-scoped-repository";
import { StrategiesRepository, StructuresRepository } from "@/modules/strategies";

import { BacktestRunRepository, type BacktestRunRecord } from "./backtest-run-repository";
import { loadBacktestMarketView } from "./market-view";

// A generous per-call ceiling under a raised `maxDuration`: the route
// handler leans on this default; the chunk-invariance integration test
// overrides it with a small value to force the same run across several
// calls without needing hundreds of ingested sessions.
export const DEFAULT_SESSION_BUDGET = 250;

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

// Runs one budgeted chunk of a backtest and persists exactly what the
// engine returned: a "paused" checkpoint to resume from on the next call,
// or the final "complete" result, which the database then refuses to ever
// overwrite (backtest_runs_no_update_once_complete trigger).
export async function runBacktestChunk(
  db: Database,
  user: ScopedUser,
  runId: string,
  options: { maxSessions?: number } = {},
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

  const view = await loadBacktestMarketView(db, {
    strategy,
    universe: run.universe,
    period: run.period,
  });

  const result = await engine.runBacktest({
    view,
    config,
    ...(run.checkpoint ? { resume: run.checkpoint } : {}),
    maxSessions: options.maxSessions ?? DEFAULT_SESSION_BUDGET,
  });

  if (!result.ok) {
    if (result.error.code === "checkpoint_mismatch" && run.checkpoint) {
      // An engine-version or schema bump between chunks: the checkpoint
      // the run holds can never resume against the current engine, but a
      // full restart from session zero against the same immutable config
      // still produces the same deterministic result (ADR-0004), so this
      // is recoverable rather than terminal.
      const restarted = await engine.runBacktest({
        view,
        config,
        maxSessions: options.maxSessions ?? DEFAULT_SESSION_BUDGET,
      });
      if (restarted.ok) {
        return persistProgress(repository, runId, restarted.value);
      }
      const message = describeEngineError(restarted.error);
      await repository.fail(runId, message);
      return { status: "failed", error: message };
    }
    const message = describeEngineError(result.error);
    await repository.fail(runId, message);
    return { status: "failed", error: message };
  }

  return persistProgress(repository, runId, result.value);
}

async function persistProgress(
  repository: BacktestRunRepository,
  runId: string,
  value: BacktestProgress,
): Promise<BacktestChunkOutcome> {
  if (value.status === "paused") {
    const saved = await repository.saveProgress(runId, {
      status: "paused",
      checkpoint: value.checkpoint,
      configDigest: value.checkpoint.configDigest,
      sessionsDone: value.sessionsDone,
      sessionsTotal: value.sessionsTotal,
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
  });
  return { status: "complete", run: saved };
}

// The raw engine code is what the "error" column stores; the report and
// button translate it to pt-BR at display time (strings.ts
// engineErrorMessage), the same split NoteCode already uses.
function describeEngineError(error: { code: EngineErrorCode }): string {
  return error.code;
}
