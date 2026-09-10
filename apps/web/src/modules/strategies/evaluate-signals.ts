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
  // Distinct from `usersEvaluated` (#19 round 3 item 3): a user whose every
  // active strategy's watermark already covers `at` did no engine work this
  // run, so counting them as "evaluated" hides that the manual re-run the
  // cron POST handler documents was a silent no-op.
  usersAlreadyCaughtUp: number;
  // Strategies left unprocessed when the in-loop deadline (round 3 item 2)
  // broke the per-strategy loop early, across every user this run touched
  // (round 4 item 7): a user counted as `usersEvaluated` because at least
  // one of their strategies ran can otherwise hide that N siblings were
  // silently deferred to the next run with no visible trace.
  strategiesDeferred: number;
  signalsWritten: number;
  evaluationsWritten: number;
  errors: string[];
}

const SETUP_FAILED = "setup_failed";

// A month of B3 trading sessions (~21/month), the round-3 item 2 ceiling: a
// catch-up wider than this is clamped rather than run in full. Bounds both
// the engine work a single run can be asked to do (so a long-dormant
// watchlist or strategy can never alone blow past `maxDuration`, which used
// to kill the loop mid-user and — before the round-3 item 1 fix — corrupt a
// sibling strategy's watermark) and how many backdated entry proposals, all
// sized against *today's* risk profile, can land in one night's inbox.
export const CATCH_UP_SESSION_LIMIT = 21;

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
    usersAlreadyCaughtUp: 0,
    strategiesDeferred: 0,
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

// Bounds a catch-up range to `CATCH_UP_SESSION_LIMIT` sessions (#19 round 3
// item 2): given the full set of sessions a watermark implies, keep only
// the newest `CATCH_UP_SESSION_LIMIT` and report the older, dropped ones
// separately so the caller can log the gap instead of silently widening
// `since`. A range already within the limit is returned unchanged with no
// clamp record.
interface ClampedCatchUp {
  sessions: TradingSession[];
  since: Instant | undefined;
  clamped: TradingSession[];
}

function clampCatchUpRange(
  fullSessions: readonly TradingSession[],
  since: Instant | undefined,
): ClampedCatchUp {
  if (fullSessions.length <= CATCH_UP_SESSION_LIMIT) {
    return { sessions: [...fullSessions], since, clamped: [] };
  }
  const splitAt = fullSessions.length - CATCH_UP_SESSION_LIMIT;
  const clamped = fullSessions.slice(0, splitAt);
  const sessions = fullSessions.slice(splitAt);
  const boundary = clamped[clamped.length - 1] as TradingSession;
  return { sessions, since: boundary.close, clamped };
}

// One explicit record per ticker for the span a catch-up just clamped away
// (#19 round 3 item 2), instead of the gap staying invisible: `detail`
// carries the count of dropped sessions so the evaluation log reads as "N
// older sessions were never evaluated" rather than "insufficient data" with
// no further clue. Anchored at the oldest dropped session, not the newest
// (round 4 item 10): the span then reads forward naturally from where the
// gap starts to where the retained range picks back up, instead of landing
// on the boundary right next to it.
function clampEvaluations(
  strategyId: string,
  strategyVersionId: string,
  tickers: Ticker[],
  clamped: readonly TradingSession[],
): NewEvaluation[] {
  if (clamped.length === 0) {
    return [];
  }
  const boundary = clamped[0] as TradingSession;
  return tickers.map((ticker) => ({
    strategyId,
    strategyVersionId,
    ticker,
    session: boundary.date,
    at: new Date(boundary.close),
    outcome: "insufficient_data" as const,
    detail: `catchup_clamped:${String(clamped.length)}`,
  }));
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
  let usersAlreadyCaughtUp = 0;
  let strategiesDeferred = 0;
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

      let strategiesProcessed = 0;
      let strategiesAlreadyCaughtUp = 0;
      let deadlineHitBeforeAnyWork = false;

      // Per (strategy version, session), not per user (#19 round 3 item 1):
      // each strategy reads and advances its own watermark inside this
      // loop, so a sibling strategy's failure, an unknown structure or a
      // deadline that stops this loop early never advances a strategy that
      // was never actually evaluated. The deadline is also checked here,
      // not only between users (round 3 item 2): a user with many active
      // daily strategies can otherwise alone run past the safety margin.
      for (const [index, { strategyId, version }] of activeDaily.entries()) {
        if (options.deadlineAt !== undefined && now() >= options.deadlineAt) {
          if (strategiesProcessed === 0 && strategiesAlreadyCaughtUp === 0) {
            deadlineHitBeforeAnyWork = true;
          }
          // Every strategy from here on, this one included, never ran this
          // pass (round 4 item 7): surfaced on the outcome instead of
          // staying invisible behind a user merely counted as evaluated.
          strategiesDeferred += activeDaily.length - index;
          break;
        }

        // This strategy version's own watermark (round 3 item 1): the max
        // session it was ever actually evaluated for, oldest fallback only
        // when it has none yet (its first-ever run, or just activated). A
        // strategy skipped for ten nights by a setup failure, a deadline or
        // a sibling strategy's thrown error keeps its old watermark, so the
        // next run that reaches it catches up on every session since, not
        // only the one this run drained.
        const watermark = await signalsRepository.lastEvaluatedSession(version.id);
        let watermarkSince: Instant | undefined;
        if (watermark !== null) {
          const watermarkTrading = await tradingSessionForDate(db, watermark);
          // Explicit (round 2 item 7): a watermark session that no longer
          // resolves (should not happen — the calendar is append-only)
          // falls back to the drained-range anchor rather than silently
          // losing the lower bound.
          watermarkSince = watermarkTrading?.close ?? drainedRangeSince;
        } else {
          watermarkSince = drainedRangeSince;
        }

        let since: Instant | undefined = watermarkSince;

        // Already caught up beyond `at` (a re-run for a session this
        // strategy's watermark already covers): the engine rejects
        // `since >= at` as invalid input, so this is "nothing to evaluate".
        if (since !== undefined && since >= at) {
          strategiesAlreadyCaughtUp += 1;
          continue;
        }

        const fullSessions = sessionsInCatchUpRange(calendar, since, at);
        const clampResult = clampCatchUpRange(fullSessions, since);
        const userSessions = clampResult.sessions;
        since = clampResult.since;

        // The clamp record (if any) is folded into the same
        // `createEvaluations` call as the strategy's own evaluation rows
        // below, not written separately beforehand: a single multi-row
        // INSERT is atomic, so a failure partway through this strategy's
        // write can never leave the clamp recorded with nothing else
        // written for it.
        const clampRecords =
          clampResult.clamped.length > 0
            ? clampEvaluations(strategyId, version.id, tickers, clampResult.clamped)
            : [];

        strategiesProcessed += 1;

        const writeResult = async (
          signalRows: NewSignal[],
          evaluationRows: NewEvaluation[],
        ): Promise<void> => {
          if (signalRows.length > 0) {
            signalsWritten += await signalsRepository.createSignals(signalRows);
          }
          evaluationsWritten += await signalsRepository.createEvaluations([
            ...clampRecords,
            ...evaluationRows,
          ]);
        };

        const structure = structureById.get(version.definition.structureId);
        if (!structure) {
          errors.push("unknown_structure");
          await writeResult(
            [],
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
          await writeResult(
            [],
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
          await writeResult(
            [],
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

        await writeResult(newSignals, newEvaluations);
      }

      // A separate counter from `usersEvaluated` (#19 round 3 item 3): every
      // active strategy already covered by its own watermark did no engine
      // work this run, so this is "nothing to do", never "evaluated".
      if (strategiesProcessed > 0) {
        usersEvaluated += 1;
      } else if (deadlineHitBeforeAnyWork) {
        usersSkipped += 1;
      } else if (strategiesAlreadyCaughtUp > 0) {
        usersAlreadyCaughtUp += 1;
      }
    } catch {
      errors.push("evaluation_failed");
    }
  }

  return {
    sessions: sorted,
    usersEvaluated,
    usersSkipped,
    usersAlreadyCaughtUp,
    strategiesDeferred,
    signalsWritten,
    evaluationsWritten,
    errors,
  };
}
