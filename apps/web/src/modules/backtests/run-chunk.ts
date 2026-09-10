import type { Structure } from "@fetha/contracts";
import { engine, type BacktestConfig } from "@fetha/engine";

import type { Database } from "@/db/client";
import type { ScopedUser } from "@/lib/user-scoped-repository";
import { StrategiesRepository, StructuresRepository } from "@/modules/strategies";

import { BacktestRunRepository, type BacktestRunRecord } from "./backtest-run-repository";
import { loadBacktestMarketView } from "./market-view";

// A generous per-call ceiling under a raised `maxDuration` (ADR-0010): the
// route handler leans on this default; the chunk-invariance integration
// test overrides it with a small value to force the same run across
// several calls without needing hundreds of ingested sessions.
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

async function loadStrategyVersion(
  db: Database,
  user: ScopedUser,
  strategyId: string,
  strategyVersionId: string,
): Promise<{ definition: BacktestConfig["strategy"]["definition"]; structure: Structure }> {
  const strategy = await new StrategiesRepository(db, user).findMine(strategyId);
  const version = strategy.versions.find((candidate) => candidate.id === strategyVersionId);
  if (!version) {
    throw new StrategyVersionNotFoundError();
  }
  const structures = await new StructuresRepository(db).listAll();
  const structure = structures.find((candidate) => candidate.id === version.definition.structureId);
  if (!structure) {
    throw new StructureNotFoundError();
  }
  return { definition: version.definition, structure };
}

// Runs one budgeted chunk of a backtest and persists exactly what the
// engine returned: a "paused" checkpoint to resume from on the next call,
// or the final "complete" result, which the database then refuses to ever
// overwrite (docs/adr/0013 "Checkpoints"; migration
// 0006_naive_grey_gargoyle.sql).
export async function runBacktestChunk(
  db: Database,
  user: ScopedUser,
  runId: string,
  options: { maxSessions?: number } = {},
): Promise<BacktestChunkOutcome> {
  const repository = new BacktestRunRepository(db, user);
  const run = await repository.findMine(runId);

  if (run.status === "complete") {
    return { status: "complete", run };
  }

  const { definition, structure } = await loadStrategyVersion(
    db,
    user,
    run.strategyId,
    run.strategyVersionId,
  );

  const strategy: BacktestConfig["strategy"] = {
    id: run.strategyVersionId,
    definition,
    structure,
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
    const message = describeEngineError(result.error);
    await repository.fail(runId, message);
    return { status: "failed", error: message };
  }

  if (result.value.status === "paused") {
    const saved = await repository.saveProgress(runId, {
      status: "paused",
      checkpoint: result.value.checkpoint,
      configDigest: result.value.checkpoint.configDigest,
      sessionsDone: result.value.sessionsDone,
      sessionsTotal: result.value.sessionsTotal,
    });
    return {
      status: "paused",
      run: saved,
      sessionsDone: result.value.sessionsDone,
      sessionsTotal: result.value.sessionsTotal,
    };
  }

  const saved = await repository.complete(runId, {
    result: result.value.run,
    configDigest: result.value.run.configDigest,
    sessionsDone: result.value.run.metrics.sessions,
  });
  return { status: "complete", run: saved };
}

function describeEngineError(error: { code: string }): string {
  return error.code;
}
