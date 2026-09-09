import type { Database } from "@/db/client";
import type { IngestionSource } from "@/db/schema/market-data";

import { closuresForYear, tradingSessionsForYear } from "./adapters/anbima-calendar/source";
import { fetchInstrumentsRegistry } from "./adapters/b3-instruments/fetch";
import { fetchSgsSeries } from "./adapters/bacen-sgs/fetch";
import { sgsSeriesCodes } from "./adapters/bacen-sgs/schema";
import { fetchCotahist } from "./adapters/cotahist/fetch";
import { gaps } from "./freshness";
import { withSourceLock } from "./repositories/advisory-lock";
import { upsertDailyCandles } from "./repositories/candle-repository";
import {
  sessionByDate,
  sessionsFrom,
  upsertTradingSessions,
} from "./repositories/calendar-repository";
import {
  finishRun,
  findSucceededRun,
  reapStaleRunningRuns,
  startRun,
} from "./repositories/ingestion-run-repository";
import { latestMacroPointDate, upsertMacroPoints } from "./repositories/macro-repository";
import { upsertOptionDailyPrices, upsertOptionSeries } from "./repositories/option-repository";

const DEFAULT_MAX_DURATION_MS = 300_000;
const FIRST_INGESTED_CALENDAR_YEAR = 2024;
// SGS is never backfilled before the calendar's own coverage starts;
// resolveAsOfInstant throws for any point older than the earliest recorded
// session (docs/adr/0017), so starting earlier would only fail loudly.
const SGS_DEFAULT_START = `${String(FIRST_INGESTED_CALENDAR_YEAR)}-01-01`;

export interface SourceOutcome {
  source: IngestionSource;
  skipped: boolean;
  rowCount: number;
  error?: string;
}

export interface IngestOutcome {
  session: string | null;
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

// Keyed on a hash of the year's holiday list and B3 closures folded into a
// day offset within the year, not a static `{year}-01-01` marker: `session`
// is a Postgres `date` column, so the marker must stay a valid calendar
// date, but a corrected ANBIMA source file or a newly added B3 closure now
// changes the marker and re-runs the year instead of the old fixed marker
// permanently reporting it as already ingested (docs/adr/0017).
export function calendarMarkerSession(year: number): string {
  const closures = [...closuresForYear(year)].sort().join(",");
  const dayOffset = contentHash(closures) % DAYS_IN_HASH_RANGE;
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
  return {
    source,
    skipped: outcomes.every((outcome) => outcome.skipped),
    rowCount: outcomes.reduce((total, outcome) => total + outcome.rowCount, 0),
    ...(errors.length > 0 ? { error: errors.join("; ") } : {}),
  };
}

// The running row is inserted and committed with the plain `db` handle
// before the locked work starts, and finished (succeeded/failed) with `db`
// again after the lock is released: the advisory lock only ever wraps the
// fetch-plus-write `run()` callback, never the bookkeeping around it, so a
// `running` row is visible to `reapStaleRunningRuns` the moment a run starts
// instead of only becoming visible once it has already finished (docs/adr/0017).
async function runSource(
  db: Database,
  source: IngestionSource,
  session: string,
  maxDurationMs: number,
  run: () => Promise<number>,
): Promise<SourceOutcome> {
  await reapStaleRunningRuns(db, source, new Date(Date.now() - maxDurationMs));

  const existing = await findSucceededRun(db, source, session);
  if (existing) {
    return { source, skipped: true, rowCount: existing.rowCount ?? 0 };
  }

  const runId = await startRun(db, source, session);
  try {
    const rowCount = await withSourceLock(db, source, async (tx) => {
      const alreadySucceeded = await findSucceededRun(tx, source, session);
      if (alreadySucceeded) {
        return alreadySucceeded.rowCount ?? 0;
      }
      return run();
    });
    await finishRun(db, runId, { status: "succeeded", rowCount });
    return { source, skipped: false, rowCount };
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    await finishRun(db, runId, { status: "failed", error: message });
    return { source, skipped: false, rowCount: 0, error: message };
  }
}

// Every gap in the last `RECENT_SESSION_WINDOW` window, oldest first, is
// attempted this invocation (not just the single oldest one): a source
// pinned on one permanently-failing session would otherwise never make
// progress on the sessions after it (docs/adr/0017).
async function runSessionBoundSource(
  db: Database,
  source: IngestionSource,
  sessions: string[],
  maxDurationMs: number,
  run: (session: string) => Promise<number>,
): Promise<SourceOutcome | null> {
  if (sessions.length === 0) {
    return null;
  }
  const outcomes: SourceOutcome[] = [];
  for (const session of sessions) {
    outcomes.push(await runSource(db, source, session, maxDurationMs, () => run(session)));
  }
  return mergeOutcomes(source, outcomes);
}

async function runCalendarSources(
  db: Database,
  now: Date,
  maxDurationMs: number,
): Promise<SourceOutcome> {
  const lastYear = now.getUTCFullYear() + 1;
  const outcomes: SourceOutcome[] = [];
  for (let year = FIRST_INGESTED_CALENDAR_YEAR; year <= lastYear; year += 1) {
    const outcome = await runSource(
      db,
      "calendar",
      calendarMarkerSession(year),
      maxDurationMs,
      () => Promise.resolve(upsertTradingSessions(db, tradingSessionsForYear(year))),
    );
    outcomes.push(outcome);
  }
  return mergeOutcomes("calendar", outcomes);
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
  const cotahistOutcome = await runSessionBoundSource(
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
  const instrumentsOutcome = await runSessionBoundSource(
    db,
    "instruments",
    instrumentsSessions,
    maxDurationMs,
    async (session) => {
      const trading = await sessionByDate(db, session);
      if (!trading) {
        throw new Error(`no trading session recorded for ${session}`);
      }
      const series = await fetchInstrumentsRegistry(session, fetchImpl);
      return upsertOptionSeries(db, trading.close, series);
    },
  );

  const sgsSessions = await resolveSessions("sgs");
  const sgsOutcome = await runSessionBoundSource(
    db,
    "sgs",
    sgsSessions,
    maxDurationMs,
    async (session) => {
      let total = 0;
      for (const series of Object.keys(sgsSeriesCodes) as Array<keyof typeof sgsSeriesCodes>) {
        const since = (await latestMacroPointDate(db, series)) ?? SGS_DEFAULT_START;
        const from = nextDay(since);
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

  const sources = [calendarOutcome, cotahistOutcome, instrumentsOutcome, sgsOutcome].filter(
    (outcome): outcome is SourceOutcome => outcome !== null,
  );

  return {
    session: options.session ?? cotahistSessions.at(-1) ?? null,
    ok: sources.every((outcome) => outcome.error === undefined),
    sources,
  };
}

function nextDay(isoDate: string): string {
  const date = new Date(`${isoDate}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}
