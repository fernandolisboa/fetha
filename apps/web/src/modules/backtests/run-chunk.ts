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
import { loadMarketView, MarketViewUnavailableError } from "@/modules/market-data";
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
//
// Measured (round 2 item 18) against a realistic view (250 sessions x 50
// tickers, the DEFAULT_SESSION_BUDGET x the create-run universe ceiling):
// one full chunk in a single `engine.runBacktest` call (its own setup and
// O(candles) index builds paid once) took ~23.5s; the same chunk split
// into ten inner calls of 25 sessions each (this constant's old value, each
// paying that setup again) took ~27.4s — about 17% pure repeated-setup
// overhead. Raising the step to 50 (five inner calls instead of ten) roughly
// halves that overhead while still checkpointing often enough that a kill
// mid-chunk loses at most 50 sessions of progress, not materially different
// from the 25-session loss the wall-clock budget (240s) was already
// generous enough to absorb.
export const DEFAULT_INNER_STEP_SESSIONS = 50;

// route.ts raises `maxDuration` to 300s. Measured from the chunk's own
// start (round 3 item 4), not from after the MarketView load, so this 240s
// budget already includes the claim and the load, not just the inner loop:
// the 60s left over is headroom for the DB round trip around each inner
// call and the one inner step the loop can still run past its deadline
// check, so the platform's own timeout — not this budget — is never what
// kills a chunk's progress.
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
  // Captured before the claim and the MarketView load, not after: the
  // wall-clock budget below is measured from the chunk's real start, so a
  // load that grows with the universe/session ceiling (round 3 item 4)
  // eats into the same 240s window the inner loop runs under instead of
  // sitting on top of it unaccounted for, which is what let the worst
  // permitted chunk's total exceed route.ts's 300s `maxDuration`.
  const now = options.now ?? Date.now;
  const chunkStart = now();

  const repository = new BacktestRunRepository(db, user);
  const claimed = await repository.findMine(runId);

  if (claimed.status === "complete") {
    return { status: "complete", run: claimed };
  }

  const claimNow = options.now ? new Date(options.now()) : new Date();
  const run = await repository.claim(runId, claimNow);

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

  let view;
  try {
    view = await loadMarketView(db, {
      strategy,
      universe: run.universe,
      period: run.period,
    });
  } catch (error) {
    if (error instanceof MarketViewUnavailableError) {
      const message = "no_market_data";
      await repository.fail(runId, message);
      return { status: "failed", error: message };
    }
    throw error;
  }

  // A run that already stamped a dataVersion on an earlier chunk must see
  // that exact version again, including a view that now has none at all
  // (round 2 item 8): a degenerate, candle-less view is not "no data to
  // compare", it is proof the dataset moved under the run, and running the
  // rest of the budget against zero candles would complete silently instead
  // of failing loudly.
  if (run.dataVersion && run.dataVersion !== view.dataVersion) {
    const message = "data_version_changed";
    await repository.fail(runId, message);
    return { status: "failed", error: message };
  }
  const dataVersion = run.dataVersion ?? view.dataVersion ?? null;

  const deadline = chunkStart + (options.wallClockBudgetMs ?? DEFAULT_WALL_CLOCK_BUDGET_MS);
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
