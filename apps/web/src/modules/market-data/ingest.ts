import type { Database } from "@/db/client";
import { postgresErrorOf } from "@/db/pg-error";
import type { IngestionSource } from "./schema";

import { closuresForYear, tradingSessionsForYear } from "./adapters/anbima-calendar/source";
import { fetchInstrumentsRegistry } from "./adapters/b3-instruments/fetch";
import { fetchSgsSeries } from "./adapters/bacen-sgs/fetch";
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
} from "./repositories/ingestion-run-repository";
import { latestMacroPointDate, upsertMacroPoints } from "./repositories/macro-repository";
import { upsertOptionDailyPrices, upsertOptionSeries } from "./repositories/option-repository";

const DEFAULT_MAX_DURATION_MS = 300_000;
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
}

// A run callback normally just reports how many rows it wrote; one that also
// dropped non-conforming rows (the instruments registry) reports that count
// too so it survives into the SourceOutcome instead of only a console.warn.
type RunResult = number | { rowCount: number; skippedRows: number };

function normalizeRunResult(result: RunResult): { rowCount: number; skippedRows?: number } {
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
  return {
    source,
    skipped: outcomes.every((outcome) => outcome.skipped),
    rowCount: outcomes.reduce((total, outcome) => total + outcome.rowCount, 0),
    ...(errors.length > 0 ? { error: errors.join("; ") } : {}),
    ...(skippedRows > 0 ? { skippedRows } : {}),
  };
}

function isUniqueViolation(error: unknown): boolean {
  return postgresErrorOf(error)?.code === "23505";
}

const MAX_INGESTION_ERROR_MESSAGE_LENGTH = 200;

// Drizzle's own `DrizzleQueryError` message is `Failed query: <sql>\nparams:
// <params>` — the bound statement itself, which for a market-data write can
// carry a full day's ticker/price rows. That string must never reach
// `ingestion_runs.error` or the nightly job's outcome/logs, whether it is the
// caught error's own message (a query that failed for a reason the driver
// never turned into a Postgres error, e.g. a dropped connection mid-query) or
// sits one level down as `.cause` on something else that wraps it. A
// duck-typed check on `.query` matches drizzle-orm's real error class
// (which also carries `.params`, but `.query` alone is enough to identify
// it) without importing it; the message pattern is a second, cheaper check
// for anything shaped the same way without that own property.
function isDrizzleQueryErrorShape(value: unknown): boolean {
  if (!(value instanceof Error)) {
    return false;
  }
  if ("query" in value && typeof (value as { query: unknown }).query === "string") {
    return true;
  }
  return value.message.startsWith("Failed query:");
}

function leaksQuery(error: unknown): boolean {
  if (isDrizzleQueryErrorShape(error)) {
    return true;
  }
  const cause = error instanceof Error ? error.cause : undefined;
  return isDrizzleQueryErrorShape(cause);
}

function truncate(message: string, maxLength: number): string {
  return message.length > maxLength ? `${message.slice(0, maxLength)}…` : message;
}

// The single place ingest.ts turns a caught error into the short string that
// lands in `ingestion_runs.error` and the nightly job's outcome/logs: a
// Postgres error is reduced to its SQLSTATE (plus the violated constraint
// when the driver reports one), never its own message, since that message is
// driver-formatted free text that can itself echo back bound values.
export function ingestionErrorMessage(error: unknown): string {
  const postgresError = postgresErrorOf(error);
  if (postgresError) {
    return postgresError.constraint
      ? `${postgresError.code} (${postgresError.constraint})`
      : postgresError.code;
  }
  if (leaksQuery(error)) {
    return "database query failed";
  }
  if (error instanceof Error && error.message.length > 0) {
    return truncate(error.message, MAX_INGESTION_ERROR_MESSAGE_LENGTH);
  }
  return "unknown error";
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
      const { rowCount, skippedRows } = normalizeRunResult(await run());
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
    if (result.skipped) {
      await deleteRun(db, startedRunId);
    }
    return {
      source,
      skipped: result.skipped,
      rowCount: result.rowCount,
      ...("skippedRows" in result && result.skippedRows !== undefined
        ? { skippedRows: result.skippedRows }
        : {}),
    };
  } catch (error) {
    const message = ingestionErrorMessage(error);
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
export async function runSessionBoundSource(
  db: Database,
  source: IngestionSource,
  sessions: string[],
  maxDurationMs: number,
  run: (session: string) => Promise<RunResult>,
): Promise<SessionBoundResult> {
  const outcomes: SourceOutcome[] = [];
  const okSessions: string[] = [];
  for (const session of sessions) {
    const outcome = await runSource(db, source, session, maxDurationMs, () => run(session));
    outcomes.push(outcome);
    if (outcome.error === undefined) {
      okSessions.push(session);
    }
  }
  return { outcome: mergeOutcomes(source, outcomes), okSessions };
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
async function removeUnlistedSessions(
  db: Database,
  year: number,
  sessions: ReturnType<typeof tradingSessionsForYear>,
): Promise<SourceOutcome> {
  try {
    const result = await deleteUnlistedTradingSessions(db, year, sessions);
    if ("blocked" in result) {
      return {
        source: "calendar",
        skipped: false,
        rowCount: 0,
        error: `market data exists on removed session(s), not deleted: ${result.blocked.join(", ")}`,
      };
    }
    return { source: "calendar", skipped: result.removed === 0, rowCount: result.removed };
  } catch (error) {
    return { source: "calendar", skipped: false, rowCount: 0, error: ingestionErrorMessage(error) };
  }
}

export interface IngestOptions {
  session?: string;
  now?: Date;
  fetchImpl?: typeof fetch;
  maxDurationMs?: number;
}

export async function ingest(db: Database, options: IngestOptions = {}): Promise<IngestOutcome> {
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
      for (const series of Object.keys(sgsSeriesCodes) as Array<keyof typeof sgsSeriesCodes>) {
        const latest = await latestMacroPointDate(db, series);
        const from = resolveSgsFromDate(latest);
        if (from > session) {
          continue;
        }
        const sessions = await sessionsFrom(db, from);
        const points = await fetchSgsSeries(series, from, session, sessions, fetchImpl);
        total += await upsertMacroPoints(db, points);
      }
      return total;
    },
  );

  const sources = [
    calendarOutcome,
    cotahistResult.outcome,
    instrumentsResult.outcome,
    sgsResult.outcome,
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

  return {
    session,
    okSessions,
    ok: sources.every((outcome) => outcome.error === undefined),
    sources,
  };
}

function nextDay(isoDate: string): string {
  const date = new Date(`${isoDate}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}
