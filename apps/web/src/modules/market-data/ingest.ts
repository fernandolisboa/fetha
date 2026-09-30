import type { Database } from "@/db/client";
import { postgresErrorOf, safeDbErrorMessage } from "@/db/pg-error";
import type { IngestionSource } from "./schema";

import { closuresForYear, tradingSessionsForYear } from "./adapters/anbima-calendar/source";
import { fetchInstrumentsRegistry } from "./adapters/b3-instruments/fetch";
import { SgsNotPublishedError, fetchSgsSeries } from "./adapters/bacen-sgs/fetch";
import { sgsSeriesCodes } from "./adapters/bacen-sgs/schema";
import { fetchCotahist } from "./adapters/cotahist/fetch";
import { gaps, latestSession } from "./freshness";
import { withSourceLock } from "./repositories/advisory-lock";
import { upsertDailyCandles } from "./repositories/candle-repository";
import {
  deleteUnlistedTradingSessions,
  sessionByDate,
  sessionsFrom,
  upsertTradingSessions,
} from "./repositories/calendar-repository";
import {
  deleteRun,
  finishRun,
  findSucceededRun,
  reapStaleRunningRuns,
  startRun,
  succeededSessionsMissingRun,
} from "./repositories/ingestion-run-repository";
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
}

// A run callback normally just reports how many rows it wrote; one that also
// dropped non-conforming rows (the instruments registry) reports that count
// too so it survives into the SourceOutcome instead of only a console.warn.
// One whose provider has not published the session yet reports `pending`
// with the rows it did write, and no succeeded marker is recorded.
type RunResult =
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

  const sgsSessions = await resolveSessions("sgs");
  const sgsResult = await runSessionBoundSource(
    db,
    "sgs",
    sgsSessions,
    maxDurationMs,
    async (session) => {
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
    },
  );

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
  const ivIndexHardStopAt = startedAt + maxDurationMs * IV_INDEX_HARD_STOP_FRACTION;
  const ivIndexRun = async (session: string): Promise<RunResult> => {
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
  const ivIndexRestResult = await runSessionBoundSource(
    db,
    "iv_index",
    ivIndexRestSessions,
    maxDurationMs,
    ivIndexRun,
    startedAt + ivIndexStartBudgetMs,
  );
  const ivIndexResult = {
    outcome: mergeOutcomes("iv_index", [ivIndexNewestResult.outcome, ivIndexRestResult.outcome]),
    okSessions: [...ivIndexNewestResult.okSessions, ...ivIndexRestResult.okSessions],
  };

  const sources = [
    calendarOutcome,
    cotahistResult.outcome,
    instrumentsResult.outcome,
    sgsResult.outcome,
    ivIndexResult.outcome,
  ];

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

  // iv_index errors stay out of `ok` the same way cotahistSucceeded keeps
  // sgs/instruments failures from blocking evaluation (run-nightly-job.ts):
  // it is computed reference data derived from the other sources, never
  // itself a dependency the cron response should 500 on (docs/adr/0054).
  return {
    session,
    okSessions,
    ok: sources
      .filter((outcome) => outcome.source !== "iv_index")
      .every((outcome) => outcome.error === undefined),
    sources,
  };
}

function nextDay(isoDate: string): string {
  const date = new Date(`${isoDate}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}
