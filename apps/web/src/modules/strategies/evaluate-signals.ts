import type { Instant, Structure, Ticker } from "@fetha/contracts";
import { engine, type Signal, type StrategyVersion } from "@fetha/engine";

import type { Database } from "@/db/client";
import {
  calendarUpTo,
  loadMarketView,
  previousTradingSession,
  tradingSessionForDate,
} from "@/modules/market-data";
import { RiskProfileRepository } from "@/modules/portfolio";
import { WatchlistRepository } from "@/modules/watchlist";

import { activeStrategyUserIds } from "./active-strategy-users";
import { SignalsRepository, type NewEvaluation, type NewSignal } from "./signals-repository";
import { StrategiesRepository } from "./strategies-repository";
import { StructuresRepository } from "./structures-repository";

export interface EvaluateSignalsOutcome {
  sessions: string[];
  usersEvaluated: number;
  usersSkipped: number;
  signalsWritten: number;
  evaluationsWritten: number;
  errors: string[];
}

const SETUP_FAILED = "setup_failed";

export interface EvaluateSignalsOptions {
  // Epoch ms after which no further user is started this run; the ones
  // already in flight still finish. Unset means no deadline (CLAUDE.md
  // "backtests chunk before considering other infrastructure" applies the
  // same way here: a caller with a real budget threads one in, tests don't
  // have to).
  deadlineAt?: number;
  now?: () => number;
}

function emptyOutcome(sessions: string[], errors: string[] = []): EvaluateSignalsOutcome {
  return {
    sessions,
    usersEvaluated: 0,
    usersSkipped: 0,
    signalsWritten: 0,
    evaluationsWritten: 0,
    errors,
  };
}

function signalToNewSignal(strategyId: string, signal: Signal): NewSignal {
  const base = {
    strategyId,
    strategyVersionId: signal.strategyVersionId,
    ticker: signal.ticker,
    timeframe: signal.timeframe,
    session: signal.session,
    at: new Date(signal.at),
    indicators: signal.indicators,
  };
  if (signal.kind === "entry") {
    return { ...base, kind: "entry", proposal: signal.proposal, operationId: null, rule: null };
  }
  if (signal.kind === "exit") {
    return {
      ...base,
      kind: "exit",
      proposal: null,
      operationId: signal.operationId,
      rule: signal.rule,
    };
  }
  return {
    ...base,
    kind: "adjust",
    proposal: signal.proposal,
    operationId: signal.operationId,
    rule: signal.rule,
  };
}

function failureEvaluations(
  strategyId: string,
  strategyVersionId: string,
  tickers: Ticker[],
  session: string,
  at: Date,
  code: string,
): NewEvaluation[] {
  return tickers.map((ticker) => ({
    strategyId,
    strategyVersionId,
    ticker,
    session,
    at,
    outcome: "insufficient_data",
    detail: code,
  }));
}

// Chained after ingestion in the cron, per user, per active daily strategy,
// over that user's watchlist (#19, CONTEXT.md "Nightly ingestion and daily
// evaluation"). `sessions` are every session `ingest()` just drained, oldest
// first (a multi-day outage drains more than one): the engine evaluates the
// whole `(since, at]` catch-up in one call per strategy, so every session in
// it — not only the newest — reaches the inbox and the evaluation log.
// Every write goes through a SignalsRepository bound to the user it was
// evaluated for, so an evaluation for user A can never land in user B's
// inbox.
export async function evaluateSignalsForSession(
  db: Database,
  sessions: string[],
  options: EvaluateSignalsOptions = {},
): Promise<EvaluateSignalsOutcome> {
  if (sessions.length === 0) {
    return emptyOutcome(sessions);
  }
  const sorted = [...sessions].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const oldest = sorted[0] as string;
  const newest = sorted.at(-1) as string;
  const now = options.now ?? Date.now;

  let at: Instant;
  let since: Instant | undefined;
  let structures: Structure[];
  let userIds: string[];
  try {
    const newestTrading = await tradingSessionForDate(db, newest);
    if (!newestTrading) {
      return emptyOutcome(sorted);
    }
    at = newestTrading.close;
    const previous = await previousTradingSession(db, oldest);
    since = previous?.close;

    structures = await new StructuresRepository(db).listAll();
    userIds = await activeStrategyUserIds(db);
  } catch (error) {
    console.error(
      "evaluateSignalsForSession setup failed",
      error instanceof Error ? error.message : "unknown error",
    );
    return emptyOutcome(sorted, [SETUP_FAILED]);
  }
  const structureById = new Map(structures.map((structure) => [structure.id, structure]));

  const calendar = await calendarUpTo(db, new Date(at));

  let usersEvaluated = 0;
  let usersSkipped = 0;
  let signalsWritten = 0;
  let evaluationsWritten = 0;
  const errors: string[] = [];

  for (const userId of userIds) {
    if (options.deadlineAt !== undefined && now() >= options.deadlineAt) {
      usersSkipped += 1;
      continue;
    }
    const scopedUser = { id: userId };
    try {
      const strategiesRepository = new StrategiesRepository(db, scopedUser);
      const activeDaily = await strategiesRepository.listActiveDaily();
      if (activeDaily.length === 0) {
        continue;
      }

      const watchlist = await new WatchlistRepository(db, scopedUser).list();
      const tickers = watchlist.map((item) => item.ticker);
      if (tickers.length === 0) {
        continue;
      }

      // No declared profile is not a placeholder-worthy gap (UBIQUITOUS_LANGUAGE.md
      // "Risk profile" is append-only, never inferred): `riskProfile` stays
      // undefined and the engine's own documented `unsizeable` /
      // `no_declared_capital` path records that to the evaluation log, never
      // to the inbox, instead of sizing against invented capital.
      const riskProfile = await new RiskProfileRepository(db, scopedUser).current();

      const signalsRepository = new SignalsRepository(db, scopedUser);

      for (const { strategyId, version } of activeDaily) {
        const structure = structureById.get(version.definition.structureId);
        if (!structure) {
          errors.push("unknown_structure");
          evaluationsWritten += await signalsRepository.createEvaluations(
            failureEvaluations(
              strategyId,
              version.id,
              tickers,
              newest,
              new Date(at),
              "unknown_structure",
            ),
          );
          continue;
        }
        const strategyVersion: StrategyVersion = {
          id: version.id,
          definition: version.definition,
          structure,
        };

        const window = engine.dataWindow({
          strategy: strategyVersion,
          instruments: tickers,
          calendar,
          at,
          since,
        });
        const view = await loadMarketView(db, window);

        const result = await engine.evaluateStrategy({
          view,
          strategy: strategyVersion,
          instruments: tickers,
          at,
          since,
          ...(riskProfile ? { riskProfile } : {}),
        });

        if (!result.ok) {
          errors.push(`engine_error:${result.error.code}`);
          evaluationsWritten += await signalsRepository.createEvaluations(
            failureEvaluations(
              strategyId,
              version.id,
              tickers,
              newest,
              new Date(at),
              `engine_error:${result.error.code}`,
            ),
          );
          continue;
        }

        const newSignals: NewSignal[] = result.value.signals.map((signal) =>
          signalToNewSignal(strategyId, signal),
        );
        const newEvaluations: NewEvaluation[] = result.value.evaluations.map((record) => ({
          strategyId,
          strategyVersionId: version.id,
          ticker: record.ticker,
          session: record.session,
          at: new Date(record.at),
          outcome: record.outcome,
          detail: record.detail,
        }));

        signalsWritten += await signalsRepository.createSignals(newSignals);
        evaluationsWritten += await signalsRepository.createEvaluations(newEvaluations);
      }
      usersEvaluated += 1;
    } catch {
      errors.push("evaluation_failed");
    }
  }

  return {
    sessions: sorted,
    usersEvaluated,
    usersSkipped,
    signalsWritten,
    evaluationsWritten,
    errors,
  };
}
