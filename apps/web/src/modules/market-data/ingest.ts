import type { Database } from "@/db/client";
import { postgresErrorOf, safeDbErrorMessage } from "@/db/pg-error";
import type { IngestionSource } from "./schema";

import { closuresForYear, tradingSessionsForYear } from "./adapters/anbima-calendar/source";
import { fetchInstrumentsRegistry } from "./adapters/b3-instruments/fetch";
import { SgsNotPublishedError, fetchPtaxSeries, fetchSgsSeries } from "./adapters/bacen-sgs/fetch";
import { exchangeRatePairValues, sgsSeriesCodes } from "./adapters/bacen-sgs/schema";
import { fetchIndexYear } from "./adapters/b3-indexes/fetch";
import type { IndexClosePoint } from "./adapters/b3-indexes/schema";
import { fetchCotahist } from "./adapters/cotahist/fetch";
import { gaps, latestSession } from "./freshness";
import { ibovespa } from "./market-index";
import { withSourceLock } from "./repositories/advisory-lock";
import {
  latestCandle,
  upsertDailyCandles,
  upsertIndexCandles,
} from "./repositories/candle-repository";
import {
  deleteUnlistedTradingSessions,
  sessionByDate,
  sessionClosesFrom,
  sessionsFrom,
  upsertTradingSessions,
} from "./repositories/calendar-repository";
import {
  latestExchangeRateDate,
  upsertExchangeRates,
} from "./repositories/exchange-rate-repository";
import {
  deleteRun,
  finishRun,
  findSucceededRun,
  reapStaleRunningRuns,
  startRun,
  succeededSessionsMissingRun,
} from "./repositories/ingestion-run-repository";
import { ingestCvmFilings } from "./cvm-filings-source";
import { computeIvIndexForSession } from "./iv-index-compute";
import { latestMacroPointDate, upsertMacroPoints } from "./repositories/macro-repository";
import { upsertOptionDailyPrices, upsertOptionSeries } from "./repositories/option-repository";

const DEFAULT_MAX_DURATION_MS = 300_000;
// Starting a new iv_index session is gated at 40% of the route's own
// maxDurationMs, counted from ingest()'s own start, for every session except
// the newest one in the recent window: that single session is the one
// tonight's evaluation reads, so it may still start as late as the 60% hard
// stop (docs/adr/0054). The 60% figure also bounds how long a single
// session's own compute may run past its start, checked between underlyings
// inside `computeIvIndexForSession`.
const IV_INDEX_START_BUDGET_FRACTION = 0.4;
const IV_INDEX_HARD_STOP_FRACTION = 0.6;
// Starting an older sgs gap session is gated at 40% of maxDurationMs,
// counted from ingest()'s own start, and the newest one at iv_index's 60%
// hard stop (#298). A stalled Bacen costs about 31 s per session (15 s
// timeout, 1 s pause, 15 s retry, then the first series' failure aborts the
// rest), so up to ten gap sessions could otherwise outlast the route. A Bacen
// slow on all three series can hold one session for about 93 s, which can
// push tonight's iv_index session past its hard stop; that run still ends in
// time to record itself, and the next run retries both.
const SGS_START_BUDGET_FRACTION = 0.4;
// `indexes` runs after `instruments` and before `sgs` (docs/adr/0062): `iv_index` decides which
// underlyings to compute from the candles present on the session and never revisits a skipped
// one once the session succeeded, so a level landing after `iv_index` would lose `IBOV11`'s
// point for that session for good. Split the same way `sgs` is (#298): older gap sessions stop
// starting at 40%, the newest at iv_index's own 60% hard stop.
const INDEXES_START_BUDGET_FRACTION = 0.4;
// The CVM filings run right after tonight's iv_index session, which may start
// as late as its 60% hard stop, so their start budget sits past it
// (docs/adr/0060); a routine read takes seconds.
const CVM_START_BUDGET_FRACTION = 0.7;
// ptax runs last, after iv_index and cvm_filings, so it never costs cotahist/sgs/instruments
// or tonight's iv_index point any of their own budget (docs/adr/0061). Split
// the same way sgs is (#298): starting an older gap session is gated at 70%
// of maxDurationMs, counted from ingest()'s own start, and the newest one —
// the only session allowed to report `pending` on a not-yet-published value
// — gets its own later deadline, 75%, so older gaps can never starve it. A
// stalled Bacen costs about 31s per series per session (mirroring sgs), two
// series about 62s worst case: an older session starting right at 70%
// (210s of 300s) ends by about 272s, and the newest starting right at 75%
// (225s) by about 287s, both before the route's own 300s deadline, so the
// run still records itself and the next run retries whatever it missed.
const PTAX_START_BUDGET_FRACTION = 0.7;
const PTAX_NEWEST_START_BUDGET_FRACTION = 0.75;
const FIRST_INGESTED_CALENDAR_YEAR = 2024;
// The sentinel used when no macro point has ever been ingested for a series
// is the day *before* the calendar's own coverage starts, not that first day
// itself: nextDay(sentinel) must land on the first calendar day so it is
// requested, not treated as already ingested (docs/adr/0017). SGS is never
// backfilled earlier than this: resolveAsOfInstant throws for any point whose
// resolved lookup target (the date itself for cdi/selic, fifteenthOfNextMonth
// for ipca) precedes the earliest recorded session, so starting earlier would
// only fail loudly.
const SGS_DEFAULT_SINCE = `${String(FIRST_INGESTED_CALENDAR_YEAR - 1)}-12-31`;

export function resolveSgsFromDate(latestIngested: string | undefined): string {
  return nextDay(latestIngested ?? SGS_DEFAULT_SINCE);
}

export interface SourceOutcome {
  source: IngestionSource;
  skipped: boolean;
  rowCount: number;
  error?: string;
  // Rows a source's own parser dropped as non-conforming (e.g. the
  // instruments registry's out-of-scope commodity/FX option rows) rather
  // than a write failure; only sources that can partially skip rows set it.
  skippedRows?: number;
  // The provider has not published this session's data yet (#216): not an
  // error, and not succeeded either, so the session stays a gap the next
  // run retries (docs/adr/0017).
  pending?: true;
  // Sessions this invocation left entirely unattempted once its start
  // deadline passed (docs/adr/0054): implies `pending`, distinct from a
  // session that was attempted and reported `pending` itself.
  deferred?: number;
  // iv_index only: whether the session tonight's evaluation reads (the
  // outcome's own `session`) has a succeeded iv_index run, which `pending`
  // alone cannot tell while the backfill keeps the source pending night
  // after night (#264). A succeeded run may hold no point (no underlying
  // bracketed 30 days), which is not trouble. Absent when there is no such
  // session, or when the check itself failed.
  newestSessionComputed?: boolean;
}

// A run callback normally just reports how many rows it wrote; one that also
// dropped non-conforming rows (the instruments registry) reports that count
// too so it survives into the SourceOutcome instead of only a console.warn.
// One whose provider has not published the session yet reports `pending`
// with the rows it did write, and no succeeded marker is recorded.
export type RunResult =
  number | { rowCount: number; skippedRows: number } | { rowCount: number; pending: true };

function normalizeRunResult(result: RunResult): {
  rowCount: number;
  skippedRows?: number;
  pending?: true;
} {
  return typeof result === "number" ? { rowCount: result } : result;
}

export interface IngestOutcome {
  session: string | null;
  // Every cotahist session this run confirmed ok, oldest first (#19): after
  // a multi-day outage this holds every gap session just drained, not only
  // the newest one `session` reports, so the nightly evaluation can catch
  // up on every session that closed while ingestion was down instead of
  // silently skipping every one but the last.
  okSessions: string[];
  ok: boolean;
  sources: SourceOutcome[];
}

function contentHash(value: string): number {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (Math.imul(31, hash) + value.charCodeAt(index)) | 0;
  }
  return hash >>> 0;
}

const DAYS_IN_HASH_RANGE = 365;

// The closure count is folded into the hashed string, not only the joined
// content: a content-only hash of the joined dates can put two different
// closure lists on the same day offset by coincidence (e.g. "14" and "110"
// both land on 111), and folding the count in shifts that collision to a
// different, still-possible-but-less-likely pair rather than eliminating it
// outright — a full fix would need its own column, tracked as a possible
// follow-up, not this ticket's scope (docs/adr/0017).
export function dayOffsetForClosures(closures: readonly string[]): number {
  const joined = [...closures].sort().join(",");
  return contentHash(`${String(closures.length)}:${joined}`) % DAYS_IN_HASH_RANGE;
}

// Keyed on a hash of the year's holiday list and B3 closures folded into a
// day offset within the year, not a static `{year}-01-01` marker: `session`
// is a Postgres `date` column, so the marker must stay a valid calendar
// date, but a corrected ANBIMA source file or a newly added B3 closure now
// changes the marker and re-runs the year instead of the old fixed marker
// permanently reporting it as already ingested (docs/adr/0017).
export function calendarMarkerSession(year: number): string {
  const dayOffset = dayOffsetForClosures(closuresForYear(year));
  const date = new Date(Date.UTC(year, 0, 1));
  date.setUTCDate(date.getUTCDate() + dayOffset);
  return date.toISOString().slice(0, 10);
}

function mergeOutcomes(source: IngestionSource, outcomes: SourceOutcome[]): SourceOutcome {
  if (outcomes.length === 0) {
    return { source, skipped: true, rowCount: 0 };
  }
  const errors = outcomes
    .map((outcome) => outcome.error)
    .filter((error): error is string => Boolean(error));
  const skippedRows = outcomes.reduce((total, outcome) => total + (outcome.skippedRows ?? 0), 0);
  const deferred = outcomes.reduce((total, outcome) => total + (outcome.deferred ?? 0), 0);
  return {
    source,
    skipped: outcomes.every((outcome) => outcome.skipped),
    rowCount: outcomes.reduce((total, outcome) => total + outcome.rowCount, 0),
    ...(errors.length > 0 ? { error: errors.join("; ") } : {}),
    ...(skippedRows > 0 ? { skippedRows } : {}),
    ...(outcomes.some((outcome) => outcome.pending) || deferred > 0
      ? { pending: true as const }
      : {}),
    ...(deferred > 0 ? { deferred } : {}),
  };
}

function isUniqueViolation(error: unknown): boolean {
  return postgresErrorOf(error)?.code === "23505";
}

// Only the initial `running` row is inserted and committed with the plain
// `db` handle before the lock is acquired, so `reapStaleRunningRuns` can see
// and age it out even while this invocation waits on the lock. The `run()`
// callback itself still writes through the plain `db` handle, not the `tx`
// `withSourceLock` hands it (docs/adr/0017): those writes autocommit
// statement by statement as they happen and are never inside a database
// transaction the lock could roll back; `pg_advisory_xact_lock` only
// serializes concurrent invocations at the application level, holding the
// lock until the transaction it lives in — the one that also writes the
// `succeeded` marker — ends. The `succeeded` marker is written from inside
// that same locked transaction so a second invocation that acquires the
// lock next always finds it before deciding whether to redo the work. Two
// runs that both started before either acquired the lock can still both
// attempt the same (source, session): the loser's `finishRun` runs inside
// its own savepoint (not the lock's transaction directly), so its
// unique-violation on the partial index rolls back only that marker write —
// never the loser's already-committed `run()` writes, which is fine because
// they wrote the same rows the winner did — and is treated as `skipped`,
// not `failed`, since the work already succeeded under the other run's id.
export async function runSource(
  db: Database,
  source: IngestionSource,
  session: string,
  maxDurationMs: number,
  run: () => Promise<RunResult>,
): Promise<SourceOutcome> {
  // runId is only known once startRun resolves; a transient DB error before
  // that (reapStaleRunningRuns, the pre-lock findSucceededRun, startRun
  // itself) has no run row to mark failed, so it is reported as a
  // SourceOutcome error directly instead of crashing the whole invocation
  // and every other source in it.
  let runId: string | undefined;
  try {
    await reapStaleRunningRuns(db, source, new Date(Date.now() - maxDurationMs));

    const existing = await findSucceededRun(db, source, session);
    if (existing) {
      return { source, skipped: true, rowCount: existing.rowCount ?? 0 };
    }

    const startedRunId = await startRun(db, source, session);
    runId = startedRunId;
    const result = await withSourceLock(db, source, async (tx) => {
      const alreadySucceeded = await findSucceededRun(tx, source, session);
      if (alreadySucceeded) {
        return { rowCount: alreadySucceeded.rowCount ?? 0, skipped: true };
      }
      const { rowCount, skippedRows, pending } = normalizeRunResult(await run());
      if (pending) {
        return { rowCount, skipped: false, pending };
      }
      const committed = await tx
        .transaction(async (savepoint) => {
          // Same nominal-type gap as withSourceLock's own cast: the
          // savepoint handle implements the query builder surface this
          // module needs, just under a stricter internal Drizzle type.
          await finishRun(savepoint as unknown as Database, startedRunId, {
            status: "succeeded",
            rowCount,
          });
        })
        .then(() => true)
        .catch((error: unknown) => {
          if (!isUniqueViolation(error)) {
            throw error;
          }
          return false;
        });
      return { rowCount, skipped: !committed, skippedRows };
    });
    if (result.skipped || "pending" in result) {
      await deleteRun(db, startedRunId);
    }
    return {
      source,
      skipped: result.skipped,
      rowCount: result.rowCount,
      ...("skippedRows" in result && result.skippedRows !== undefined
        ? { skippedRows: result.skippedRows }
        : {}),
      ...("pending" in result ? { pending: result.pending } : {}),
    };
  } catch (error) {
    const message = safeDbErrorMessage(error);
    if (runId) {
      await finishRun(db, runId, { status: "failed", error: message });
    }
    return { source, skipped: false, rowCount: 0, error: message };
  }
}

interface SessionBoundResult {
  outcome: SourceOutcome;
  // Sessions this invocation confirmed are in an ok state (just succeeded or
  // already succeeded), oldest first, used to report the newest session a
  // source actually covers rather than the newest session it merely
  // attempted (which may have failed).
  okSessions: string[];
}

// Every gap in the last `RECENT_SESSION_WINDOW` window, oldest first, is
// attempted this invocation (not just the single oldest one): a source
// pinned on one permanently-failing session would otherwise never make
// progress on the sessions after it (docs/adr/0017). A source with no gaps
// left in the window is fully caught up, not absent: it still reports a
// `{ skipped: true }` SourceOutcome instead of being dropped, so a caller
// can tell "nothing to do" apart from "this source doesn't exist".
// A session not yet started once `Date.now()` reaches `deadline` is left
// alone entirely (docs/adr/0054): not attempted, not recorded as failed or
// skipped, so it stays a gap the next run retries rather than risking the
// caller's own `maxDuration`. `sessions` is already ordered by priority, so
// once the deadline is spent the sessions left unattempted are the ones
// that mattered least this run.
export async function runSessionBoundSource(
  db: Database,
  source: IngestionSource,
  sessions: string[],
  maxDurationMs: number,
  run: (session: string) => Promise<RunResult>,
  deadline = Infinity,
): Promise<SessionBoundResult> {
  const outcomes: SourceOutcome[] = [];
  const okSessions: string[] = [];
  let attempted = 0;
  for (const session of sessions) {
    if (Date.now() >= deadline) {
      break;
    }
    attempted += 1;
    const outcome = await runSource(db, source, session, maxDurationMs, () => run(session));
    outcomes.push(outcome);
    if (outcome.error === undefined && !outcome.pending) {
      okSessions.push(session);
    }
  }
  const deferred = sessions.length - attempted;
  const merged = mergeOutcomes(source, outcomes);
  return {
    outcome: deferred > 0 ? { ...merged, skipped: false, pending: true, deferred } : merged,
    okSessions,
  };
}

async function runCalendarSources(
  db: Database,
  now: Date,
  maxDurationMs: number,
): Promise<SourceOutcome> {
  const lastYear = now.getUTCFullYear() + 1;
  const outcomes: SourceOutcome[] = [];
  for (let year = FIRST_INGESTED_CALENDAR_YEAR; year <= lastYear; year += 1) {
    const sessions = tradingSessionsForYear(year);
    const outcome = await runSource(
      db,
      "calendar",
      calendarMarkerSession(year),
      maxDurationMs,
      () => upsertTradingSessions(db, sessions),
    );
    outcomes.push(outcome);
    if (outcome.error === undefined) {
      outcomes.push(await removeUnlistedSessions(db, year, sessions));
    }
  }
  return mergeOutcomes("calendar", outcomes);
}

// Runs on every ingestion, not only when the year's marker changes: a stale
// date can predate the marker it would have changed (an earlier fixed marker,
// or a corrected file whose closures hash to the same day offset), and the
// delete is a no-op once the year matches its source (docs/adr/0017).
//
// The delete runs inside `withSourceLock(db, "cotahist", ...)` (docs/adr/0017,
// #189): that lock is taken by `runSource("cotahist", ...)` around every
// cotahist write, not by `upsertDailyCandles`/`upsertOptionDailyPrices`
// themselves, so any writer of `candles` or `option_daily_prices` must go
// through that same lock for this to hold — an invariant, not a detail of
// today's two call sites. `pg_advisory_xact_lock` blocks rather than failing
// fast, so a concurrent cotahist run either fully commits its candles before
// this delete's snapshot is taken or cannot start until this transaction
// ends — never interleaved. A concurrent invocation whose cotahist step is
// already running simply makes this call wait for it; that is slower, not
// wrong.
async function removeUnlistedSessions(
  db: Database,
  year: number,
  sessions: ReturnType<typeof tradingSessionsForYear>,
): Promise<SourceOutcome> {
  try {
    const result = await withSourceLock(db, "cotahist", (tx) =>
      deleteUnlistedTradingSessions(tx, year, sessions),
    );
    if (result.kind === "blocked") {
      return {
        source: "calendar",
        skipped: false,
        rowCount: 0,
        error: `market data exists on removed session(s), not deleted: ${result.dates.join(", ")}`,
      };
    }
    return { source: "calendar", skipped: result.removed === 0, rowCount: result.removed };
  } catch (error) {
    return { source: "calendar", skipped: false, rowCount: 0, error: safeDbErrorMessage(error) };
  }
}

export interface IngestOptions {
  session?: string;
  now?: Date;
  fetchImpl?: typeof fetch;
  maxDurationMs?: number;
  // Overrides `maxDurationMs * IV_INDEX_START_BUDGET_FRACTION`: test-only
  // knob to force that start deadline to have already elapsed (e.g. `0`)
  // without touching `maxDurationMs` itself, which `reapStaleRunningRuns`
  // also uses as a cutoff for every other source in the same invocation.
  ivIndexBudgetMs?: number;
  // Overrides `maxDurationMs * SGS_START_BUDGET_FRACTION`, for the same
  // reason as `ivIndexBudgetMs`.
  sgsBudgetMs?: number;
  // Overrides `maxDurationMs * CVM_START_BUDGET_FRACTION`, likewise.
  cvmBudgetMs?: number;
  // Overrides `maxDurationMs * PTAX_START_BUDGET_FRACTION`, for the same
  // reason as `ivIndexBudgetMs`.
  ptaxBudgetMs?: number;
  // Overrides `maxDurationMs * INDEXES_START_BUDGET_FRACTION`, for the same
  // reason as `ivIndexBudgetMs`.
  indexesBudgetMs?: number;
}

export async function ingest(db: Database, options: IngestOptions = {}): Promise<IngestOutcome> {
  const startedAt = Date.now();
  const now = options.now ?? new Date();
  const fetchImpl = options.fetchImpl ?? fetch;
  const maxDurationMs = options.maxDurationMs ?? DEFAULT_MAX_DURATION_MS;

  const calendarOutcome = await runCalendarSources(db, now, maxDurationMs);

  async function resolveSessions(source: IngestionSource): Promise<string[]> {
    if (options.session) {
      return [options.session];
    }
    return gaps(db, source, now);
  }

  const cotahistSessions = await resolveSessions("cotahist");
  const cotahistResult = await runSessionBoundSource(
    db,
    "cotahist",
    cotahistSessions,
    maxDurationMs,
    async (session) => {
      const trading = await sessionByDate(db, session);
      if (!trading) {
        throw new Error(`no trading session recorded for ${session}`);
      }
      const rows = await fetchCotahist(session, fetchImpl);
      const stocks = rows.filter((row) => row.kind === "stock");
      const optionRows = rows.filter((row) => row.kind === "option");
      const candleCount = await upsertDailyCandles(db, session, trading.close, stocks);
      const optionCount = await upsertOptionDailyPrices(db, session, trading.close, optionRows);
      return candleCount + optionCount;
    },
  );

  const instrumentsSessions = await resolveSessions("instruments");
  const instrumentsResult = await runSessionBoundSource(
    db,
    "instruments",
    instrumentsSessions,
    maxDurationMs,
    async (session) => {
      const trading = await sessionByDate(db, session);
      if (!trading) {
        throw new Error(`no trading session recorded for ${session}`);
      }
      const { series, skipped } = await fetchInstrumentsRegistry(session, fetchImpl);
      const rowCount = await upsertOptionSeries(db, trading.close, series);
      return { rowCount, skippedRows: skipped };
    },
  );

  const ivIndexHardStopAt = startedAt + maxDurationMs * IV_INDEX_HARD_STOP_FRACTION;

  // Runs after `instruments` and before `sgs` (docs/adr/0062): each calendar year touched is
  // fetched at most once per invocation, success or failure alike, so a stalled B3 is paid once
  // per year rather than once per gap session (the same per-invocation memo `cvmSnapshot` below
  // uses for its own cumulative file). Cumulative from the day after the latest stored IBOV11
  // candle, floored at `SGS_DEFAULT_SINCE` like every other reference series.
  const indexYearFetches = new Map<number, Promise<IndexClosePoint[]>>();
  function fetchIndexYearMemoised(year: number): Promise<IndexClosePoint[]> {
    const existing = indexYearFetches.get(year);
    if (existing) {
      return existing;
    }
    const promise = fetchIndexYear(year, fetchImpl);
    indexYearFetches.set(year, promise);
    return promise;
  }

  const indexesSessions = await resolveSessions("indexes");
  const indexesRun = async (session: string): Promise<RunResult> => {
    const latest = await latestCandle(db, ibovespa.ticker);
    const from = resolveSgsFromDate(latest?.session);
    if (from > session) {
      return 0;
    }
    const fromYear = Number(from.slice(0, 4));
    const toYear = Number(session.slice(0, 4));
    const years = Array.from({ length: toYear - fromYear + 1 }, (_, index) => fromYear + index);
    const bodies = await Promise.all(years.map((year) => fetchIndexYearMemoised(year)));
    const points = bodies
      .flat()
      .filter((point) => point.date >= from && point.date <= session)
      .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

    const sessionCloses = await sessionClosesFrom(db, from);
    const closeByDate = new Map(sessionCloses.map((row) => [row.date, row.close]));
    const asOfBySession = new Map<string, Date>();
    let skippedRows = 0;
    const writable: IndexClosePoint[] = [];
    for (const point of points) {
      const close = closeByDate.get(point.date);
      if (!close) {
        // A published date the ANBIMA calendar never lists as a trading session is a
        // calendar discrepancy worth seeing in the report, like the registry's own skips
        // (ADR-0062), not a write.
        skippedRows += 1;
        continue;
      }
      asOfBySession.set(point.date, close);
      writable.push(point);
    }

    const rowCount = await withSourceLock(db, "cotahist", (tx) =>
      upsertIndexCandles(tx, writable, ibovespa.ticker, asOfBySession),
    );

    const published = points.some((point) => point.date === session);
    if (published || session < from) {
      return { rowCount, skippedRows };
    }
    // The processed session's own date is missing from its year's file: not yet published
    // (ADR-0062). The newest gap session reports `pending` (rows for earlier
    // dates already written); an older gap is a thrown failure, exactly `sgsRun`'s rule.
    if (session !== indexesSessions.at(-1)) {
      throw new Error(`B3 index statistics has not published IBOV for ${session}`);
    }
    return { rowCount, pending: true };
  };
  const indexesOlderResult = await runSessionBoundSource(
    db,
    "indexes",
    indexesSessions.slice(0, -1),
    maxDurationMs,
    indexesRun,
    startedAt + (options.indexesBudgetMs ?? maxDurationMs * INDEXES_START_BUDGET_FRACTION),
  );
  const indexesNewestSession = indexesSessions.at(-1);
  const indexesNewestResult = await runSessionBoundSource(
    db,
    "indexes",
    indexesNewestSession ? [indexesNewestSession] : [],
    maxDurationMs,
    indexesRun,
    ivIndexHardStopAt,
  );
  const indexesResult = {
    outcome: mergeOutcomes("indexes", [indexesOlderResult.outcome, indexesNewestResult.outcome]),
    okSessions: [...indexesOlderResult.okSessions, ...indexesNewestResult.okSessions],
  };

  const sgsSessions = await resolveSessions("sgs");
  const sgsRun = async (session: string): Promise<RunResult> => {
    let total = 0;
    const notPublished: string[] = [];
    for (const series of Object.keys(sgsSeriesCodes) as Array<keyof typeof sgsSeriesCodes>) {
      const latest = await latestMacroPointDate(db, series);
      const from = resolveSgsFromDate(latest);
      if (from > session) {
        continue;
      }
      const sessions = await sessionsFrom(db, from);
      try {
        const points = await fetchSgsSeries(series, from, session, sessions, fetchImpl);
        total += await upsertMacroPoints(db, points);
      } catch (error) {
        if (!(error instanceof SgsNotPublishedError)) {
          throw error;
        }
        notPublished.push(series);
      }
    }
    if (notPublished.length === 0) {
      return total;
    }
    // Only the newest session can legitimately be unpublished: Bacen
    // publishes a session's CDI the next morning, so a value still missing
    // a session later is a real failure (a retired series, a bad range),
    // not something to keep reporting as pending (docs/adr/0017, #216).
    if (session !== sgsSessions.at(-1)) {
      throw new Error(`SGS has not published ${notPublished.join(", ")} for ${session}`);
    }
    return { rowCount: total, pending: true };
  };
  // Mirrors iv_index's split (docs/adr/0054): the newest session carries the
  // CDI tonight's IV index needs, so it may start until iv_index's own hard
  // stop, while every older gap stops starting at the 40% budget. Older gaps
  // still run first: the "only the newest is pending" rule above and the
  // cumulative `from`..`session` fetch both rely on oldest-first order, and
  // the newest session's fetch also fills any older gap deferred here.
  const sgsOlderResult = await runSessionBoundSource(
    db,
    "sgs",
    sgsSessions.slice(0, -1),
    maxDurationMs,
    sgsRun,
    startedAt + (options.sgsBudgetMs ?? maxDurationMs * SGS_START_BUDGET_FRACTION),
  );
  const sgsNewestSession = sgsSessions.at(-1);
  const sgsNewestResult = await runSessionBoundSource(
    db,
    "sgs",
    sgsNewestSession ? [sgsNewestSession] : [],
    maxDurationMs,
    sgsRun,
    ivIndexHardStopAt,
  );
  const sgsOutcome = mergeOutcomes("sgs", [sgsOlderResult.outcome, sgsNewestResult.outcome]);

  // Runs after cotahist and instruments, over the same recent window plus an
  // older backfill batch (docs/adr/0054): the compute step needs that
  // session's own option chain, series registry and (for the risk-free
  // proxy) CDI, so it can only start once those are in. A session ineligible
  // for that reason is `pending`, never `failed` (`ivIndexRun` below), so it
  // keeps retrying every night rather than aging into a permanent gap.
  const ivIndexRecentSessions = await resolveSessions("iv_index");
  const ivIndexBackfillCandidates = options.session
    ? []
    : (await succeededSessionsMissingRun(db, ["cotahist", "instruments"], "iv_index")).filter(
        (session) => !ivIndexRecentSessions.includes(session),
      );
  // The newest recent-window session is the one tonight's evaluation reads,
  // so it gets its own start deadline (the 60% hard stop) instead of the 40%
  // every other session — older recent sessions and the backfill batch — must
  // start under (docs/adr/0054). Both lists stay newest-first / most-recent
  // history first, so a tight budget is spent on the sessions that matter
  // most.
  const ivIndexNewestSession = ivIndexRecentSessions.at(-1);
  const ivIndexRestSessions = [
    ...new Set([...ivIndexRecentSessions.slice(0, -1)].reverse().concat(ivIndexBackfillCandidates)),
  ];
  // Every session `indexes` has outstanding (`indexesSessions`, the full gap list, not only the
  // ones this run's own start budget got around to starting) that has not succeeded this run
  // pends `iv_index` for it (docs/adr/0054/0062 addendum): a session `indexes` never even
  // attempted this run pends exactly like one it attempted and failed, so a late or
  // never-started B3 index document delays every underlying's point by one cron rather than
  // silently losing `IBOV11`'s, like the CDI gate already does.
  const indexesMissing = new Set(
    indexesSessions.filter((session) => !indexesResult.okSessions.includes(session)),
  );
  const ivIndexRun = async (session: string): Promise<RunResult> => {
    if (indexesMissing.has(session)) {
      return { rowCount: 0, pending: true as const };
    }
    const [cotahistRun, instrumentsRun] = await Promise.all([
      findSucceededRun(db, "cotahist", session),
      findSucceededRun(db, "instruments", session),
    ]);
    if (!cotahistRun || !instrumentsRun) {
      return { rowCount: 0, pending: true as const };
    }
    const trading = await sessionByDate(db, session);
    if (!trading) {
      throw new Error(`no trading session recorded for ${session}`);
    }
    const { rowCount, pending } = await computeIvIndexForSession(
      db,
      session,
      trading.close,
      ivIndexHardStopAt,
    );
    return pending ? { rowCount, pending: true as const } : rowCount;
  };
  const ivIndexStartBudgetMs =
    options.ivIndexBudgetMs ?? maxDurationMs * IV_INDEX_START_BUDGET_FRACTION;
  const ivIndexNewestResult = ivIndexNewestSession
    ? await runSessionBoundSource(
        db,
        "iv_index",
        [ivIndexNewestSession],
        maxDurationMs,
        ivIndexRun,
        ivIndexHardStopAt,
      )
    : { outcome: mergeOutcomes("iv_index", []), okSessions: [] };
  // The CVM files are cumulative yearly snapshots (docs/adr/0060): one read
  // covers every gap session, so only the first session this invocation
  // attempts downloads them and the rest share its outcome. It runs after
  // tonight's iv_index session and before the iv_index backfill, under its
  // own 70% start budget, so it never delays what tonight's evaluation
  // reads; like iv_index it stays out of `ok`, since no other
  // step reads filings and the asset page shows their freshness.
  let cvmSnapshot: Promise<RunResult> | undefined;
  const cvmRun = async (): Promise<RunResult> => {
    if (cvmSnapshot) {
      const first = normalizeRunResult(await cvmSnapshot);
      return first.pending ? { rowCount: 0, pending: true as const } : 0;
    }
    cvmSnapshot = ingestCvmFilings(db, now, fetchImpl);
    return cvmSnapshot;
  };
  const cvmResult = await runSessionBoundSource(
    db,
    "cvm_filings",
    await resolveSessions("cvm_filings"),
    maxDurationMs,
    cvmRun,
    startedAt + (options.cvmBudgetMs ?? maxDurationMs * CVM_START_BUDGET_FRACTION),
  );

  const ivIndexRestResult = await runSessionBoundSource(
    db,
    "iv_index",
    ivIndexRestSessions,
    maxDurationMs,
    ivIndexRun,
    startedAt + ivIndexStartBudgetMs,
  );
  const ivIndexOutcome = mergeOutcomes("iv_index", [
    ivIndexNewestResult.outcome,
    ivIndexRestResult.outcome,
  ]);

  // Runs last, after iv_index and cvm_filings, so a slow or down Bacen PTAX endpoint never
  // costs cotahist, instruments, sgs or tonight's iv_index point any of
  // their own start budget (docs/adr/0061). Oldest gap session first, each
  // session fetching cumulatively from (latest stored date for the pair + 1
  // day) to the session, exactly like sgsRun; the only session allowed to
  // report `pending` on a not-yet-published value is the newest, which is
  // why it is split out below with its own, later start deadline — an
  // older gap stalling Bacen must never starve the one session this run
  // most needs a fresh attempt at.
  const ptaxSessions = await resolveSessions("ptax");
  const ptaxRun = async (session: string): Promise<RunResult> => {
    let total = 0;
    const notPublished: string[] = [];
    for (const pair of exchangeRatePairValues) {
      const latest = await latestExchangeRateDate(db, pair);
      const from = resolveSgsFromDate(latest);
      if (from > session) {
        continue;
      }
      try {
        const points = await fetchPtaxSeries(pair, from, session, fetchImpl);
        total += await upsertExchangeRates(db, points);
      } catch (error) {
        if (!(error instanceof SgsNotPublishedError)) {
          throw error;
        }
        notPublished.push(pair);
      }
    }
    if (notPublished.length === 0) {
      return total;
    }
    if (session !== ptaxSessions.at(-1)) {
      throw new Error(`SGS has not published PTAX for ${notPublished.join(", ")} on ${session}`);
    }
    return { rowCount: total, pending: true };
  };
  const ptaxOlderResult = await runSessionBoundSource(
    db,
    "ptax",
    ptaxSessions.slice(0, -1),
    maxDurationMs,
    ptaxRun,
    startedAt + (options.ptaxBudgetMs ?? maxDurationMs * PTAX_START_BUDGET_FRACTION),
  );
  const ptaxNewestSession = ptaxSessions.at(-1);
  const ptaxNewestResult = await runSessionBoundSource(
    db,
    "ptax",
    ptaxNewestSession ? [ptaxNewestSession] : [],
    maxDurationMs,
    ptaxRun,
    startedAt + maxDurationMs * PTAX_NEWEST_START_BUDGET_FRACTION,
  );
  const ptaxResult = {
    outcome: mergeOutcomes("ptax", [ptaxOlderResult.outcome, ptaxNewestResult.outcome]),
  };

  // A source that is fully caught up drains no gaps this invocation
  // (`cotahistSessions` is empty), so `okSessions` is empty too even though a
  // previous run already succeeded on the newest session; falling back to
  // latestSession (the newest closed trading session as of `now`) reports
  // that session instead of `null` (docs/adr/0017). A source that *did*
  // attempt gaps but failed every one of them must not get this fallback:
  // `okSessions` is empty for the same reason, but reporting latestSession
  // there would claim success for a session ingest() never actually covered.
  const session =
    options.session ??
    cotahistResult.okSessions.at(-1) ??
    (cotahistSessions.length === 0 ? await latestSession(db, now) : null);

  // Mirrors `session`'s own fallback (a fully caught-up run still reports the
  // newest already-ingested session) rather than duplicating its logic: the
  // only case that adds real sessions is a gap catch-up, where
  // `cotahistResult.okSessions` already holds every one, oldest first.
  const okSessions =
    cotahistResult.okSessions.length > 0 ? cotahistResult.okSessions : session ? [session] : [];

  const sources = [
    calendarOutcome,
    cotahistResult.outcome,
    instrumentsResult.outcome,
    indexesResult.outcome,
    sgsOutcome,
    session ? await withNewestSessionComputed(db, ivIndexOutcome, session) : ivIndexOutcome,
    cvmResult.outcome,
    ptaxResult.outcome,
  ];

  // iv_index errors stay out of `ok` the same way cotahistSucceeded keeps
  // sgs/instruments failures from blocking evaluation (run-nightly-job.ts):
  // it is computed reference data derived from the other sources, never
  // itself a dependency the cron response should 500 on (docs/adr/0054).
  // A ptax error flips `ok` the same way an sgs/instruments one does
  // (docs/adr/0061) — `cotahistSucceeded` already gates evaluation on
  // cotahist alone, not on `ok`, so this never blocks it either.
  return {
    session,
    okSessions,
    ok: sources
      .filter((outcome) => outcome.source !== "iv_index" && outcome.source !== "cvm_filings")
      .every((outcome) => outcome.error === undefined),
    sources,
  };
}

// A diagnostics-only read after every source already did its work: its own
// failure must never discard the run's outcome, so the field is left out.
async function withNewestSessionComputed(
  db: Database,
  outcome: SourceOutcome,
  session: string,
): Promise<SourceOutcome> {
  try {
    const run = await findSucceededRun(db, "iv_index", session);
    return { ...outcome, newestSessionComputed: run !== undefined };
  } catch {
    return outcome;
  }
}

function nextDay(isoDate: string): string {
  const date = new Date(`${isoDate}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}
