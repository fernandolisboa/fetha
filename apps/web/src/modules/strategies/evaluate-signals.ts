import type { Instant, Structure, Ticker } from "@fetha/contracts";
import { engine, type Signal, type StrategyVersion, type TradingSession } from "@fetha/engine";

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

// A collection `dataWindow` can ask for that no ingestion source fills
// today (round 2 item 8, follow-up in
// https://github.com/fernandolisboa/fetha/issues/81): a strategy that needs
// it can never receive a value, so it is logged explicitly instead of
// retrying `insufficient_data` forever with no clue why.
const UNSATISFIABLE_COLLECTION_CODE = "unsatisfiable_collection:impliedVolatilityIndex";

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

// One failure/skip row per (ticker, session) in the catch-up range, not
// only under the newest session (#19 round 2 item 6): a multi-session
// catch-up that hits an unknown structure or an engine error leaves no
// silent holes for the sessions in between.
function failureEvaluations(
  strategyId: string,
  strategyVersionId: string,
  tickers: Ticker[],
  sessions: readonly TradingSession[],
  code: string,
): NewEvaluation[] {
  return sessions.flatMap((session) =>
    tickers.map((ticker) => ({
      strategyId,
      strategyVersionId,
      ticker,
      session: session.date,
      at: new Date(session.close),
      outcome: "insufficient_data" as const,
      detail: code,
    })),
  );
}

// The trading sessions a user's catch-up run actually covers, engine-shaped
// (#19 round 2 items 1, 6, 7): with a defined `since`, every session whose
// close falls in `(since, at]`; with no `since` (this user's genuine first
// evaluation ever, no watermark and no session before the drained range),
// explicitly just the single session closing at `at` — never every session
// the calendar has ever seen, which an undefined lower bound would imply if
// read as "no filter" instead of "no catch-up, single latest instant".
// `Instant` strings are fixed-width ISO-8601 UTC (`instantSchema`), so
// lexicographic and chronological order agree.
function sessionsInCatchUpRange(
  calendar: readonly TradingSession[],
  since: Instant | undefined,
  at: Instant,
): TradingSession[] {
  if (since === undefined) {
    const atSession = calendar.find((session) => session.close === at);
    return atSession ? [atSession] : [];
  }
  return calendar.filter((session) => session.close > since && session.close <= at);
}

// Chained after ingestion in the cron, per user, per active daily strategy,
// over that user's watchlist (#19, CONTEXT.md "Nightly ingestion and daily
// evaluation"). `sessions` are every session `ingest()` just drained, oldest
// first (a multi-day outage drains more than one). Every write goes through
// a SignalsRepository bound to the user it was evaluated for, so an
// evaluation for user A can never land in user B's inbox.
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
  // The `since` this run's *drained ingestion range* implies, used as the
  // fallback anchor for a user with no evaluation-log watermark of their
  // own (round 2 item 1) — never the anchor for a user who already has one.
  let drainedRangeSince: Instant | undefined;
  let structures: Structure[];
  let userIds: string[];
  let calendar: TradingSession[];
  try {
    const newestTrading = await tradingSessionForDate(db, newest);
    if (!newestTrading) {
      return emptyOutcome(sorted);
    }
    at = newestTrading.close;
    const previous = await previousTradingSession(db, oldest);
    drainedRangeSince = previous?.close;

    structures = await new StructuresRepository(db).listAll();
    userIds = await activeStrategyUserIds(db, newest);
    // Moved inside this try/catch (round 2 item 2): a transient error here
    // must return `setup_failed` with HTTP 200 like every other setup read,
    // not turn an ingestion that already succeeded into a 500 the cron
    // retries for no reason.
    calendar = await calendarUpTo(db, new Date(at));
  } catch (error) {
    console.error(
      "evaluateSignalsForSession setup failed",
      error instanceof Error ? error.message : "unknown error",
    );
    return emptyOutcome(sorted, [SETUP_FAILED]);
  }
  const structureById = new Map(structures.map((structure) => [structure.id, structure]));

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

      // Per-user watermark, not the ingestion calendar (#19 round 2 item 1):
      // the max session this user was ever actually evaluated for, oldest
      // fallback only when they have none yet (their first-ever run, or a
      // strategy just activated). A user skipped for ten nights by a setup
      // failure or a deadline keeps their old watermark, so the next run
      // that reaches them catches up on every session since, not only the
      // one this run happened to drain.
      const watermark = await signalsRepository.lastEvaluatedSession();
      let since: Instant | undefined;
      if (watermark !== null) {
        const watermarkTrading = await tradingSessionForDate(db, watermark);
        // Explicit (round 2 item 7): a watermark session that no longer
        // resolves (should not happen — the calendar is append-only) falls
        // back to the drained-range anchor rather than silently losing the
        // lower bound.
        since = watermarkTrading?.close ?? drainedRangeSince;
      } else {
        since = drainedRangeSince;
      }

      // Already caught up beyond `at` (a re-run for a session this user's
      // watermark already covers): the engine rejects `since >= at` as
      // invalid input, so this is treated as "nothing to evaluate", not an
      // error, and the strategy loop below is skipped entirely.
      if (since !== undefined && since >= at) {
        usersEvaluated += 1;
        continue;
      }

      const userSessions = sessionsInCatchUpRange(calendar, since, at);

      for (const { strategyId, version } of activeDaily) {
        const structure = structureById.get(version.definition.structureId);
        if (!structure) {
          errors.push("unknown_structure");
          evaluationsWritten += await signalsRepository.createEvaluations(
            failureEvaluations(strategyId, version.id, tickers, userSessions, "unknown_structure"),
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

        // The loader can never fill `impliedVolatilityIndex` (round 2 item
        // 8, follow-up #81): recorded explicitly per ticker/session and
        // never handed to the engine, instead of retrying
        // `insufficient_data` every night with no clue why.
        if (window.collections.includes("impliedVolatilityIndex")) {
          evaluationsWritten += await signalsRepository.createEvaluations(
            failureEvaluations(
              strategyId,
              version.id,
              tickers,
              userSessions,
              UNSATISFIABLE_COLLECTION_CODE,
            ),
          );
          continue;
        }

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
              userSessions,
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
