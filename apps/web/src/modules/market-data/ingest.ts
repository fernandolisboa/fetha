import type { Database } from "@/db/client";
import { ingestionSourceValues, type IngestionSource } from "@/db/schema/market-data";

import { tradingSessionsForYear } from "./adapters/anbima-calendar/source";
import { fetchInstrumentsRegistry } from "./adapters/b3-instruments/fetch";
import { fetchSgsSeries } from "./adapters/bacen-sgs/fetch";
import { sgsSeriesCodes } from "./adapters/bacen-sgs/schema";
import { fetchCotahist } from "./adapters/cotahist/fetch";
import { withSourceLock } from "./repositories/advisory-lock";
import { upsertDailyCandles } from "./repositories/candle-repository";
import {
  recentSessions,
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

const SGS_DEFAULT_START = "2015-01-01";
const CALENDAR_MARKER_SUFFIX = "-01-01";
const RECENT_SESSION_WINDOW = 10;
const DEFAULT_MAX_DURATION_MS = 300_000;
const FIRST_INGESTED_CALENDAR_YEAR = 2024;

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

function calendarMarkerSession(year: number): string {
  return `${String(year)}${CALENDAR_MARKER_SUFFIX}`;
}

function mergeOutcomes(source: IngestionSource, outcomes: SourceOutcome[]): SourceOutcome {
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

async function runSource(
  db: Database,
  source: IngestionSource,
  session: string,
  maxDurationMs: number,
  run: () => Promise<number>,
): Promise<SourceOutcome> {
  return withSourceLock(db, source, async (tx) => {
    await reapStaleRunningRuns(tx, source, new Date(Date.now() - maxDurationMs));

    const existing = await findSucceededRun(tx, source, session);
    if (existing) {
      return { source, skipped: true, rowCount: existing.rowCount ?? 0 };
    }

    const runId = await startRun(tx, source, session);
    try {
      const rowCount = await run();
      await finishRun(tx, runId, { status: "succeeded", rowCount });
      return { source, skipped: false, rowCount };
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown error";
      await finishRun(tx, runId, { status: "failed", error: message });
      return { source, skipped: false, rowCount: 0, error: message };
    }
  });
}

// The oldest of the last `RECENT_SESSION_WINDOW` closed sessions this source
// has no succeeded run for yet. Bounded so a session that keeps failing is
// retried by the next cron instead of the target silently jumping to the
// latest closed session and leaving a permanent hole (docs/adr/0017).
async function targetSessionForSource(
  db: Database,
  source: IngestionSource,
  at: Date,
): Promise<string | null> {
  const sessions = await recentSessions(db, at, RECENT_SESSION_WINDOW);
  for (const candidate of sessions) {
    const existing = await findSucceededRun(db, source, candidate.date);
    if (!existing) {
      return candidate.date;
    }
  }
  return null;
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

  async function resolveSession(source: IngestionSource): Promise<string | null> {
    if (options.session) {
      return options.session;
    }
    return targetSessionForSource(db, source, now);
  }

  const cotahistSession = await resolveSession("cotahist");
  const cotahistOutcome: SourceOutcome | null = cotahistSession
    ? await runSource(db, "cotahist", cotahistSession, maxDurationMs, async () => {
        const trading = await sessionByDate(db, cotahistSession);
        if (!trading) {
          throw new Error(`no trading session recorded for ${cotahistSession}`);
        }
        const rows = await fetchCotahist(cotahistSession, fetchImpl);
        const stocks = rows.filter((row) => row.kind === "stock");
        const optionRows = rows.filter((row) => row.kind === "option");
        const candleCount = await upsertDailyCandles(db, cotahistSession, trading.close, stocks);
        const optionCount = await upsertOptionDailyPrices(
          db,
          cotahistSession,
          trading.close,
          optionRows,
        );
        return candleCount + optionCount;
      })
    : null;

  const instrumentsSession = await resolveSession("instruments");
  const instrumentsOutcome: SourceOutcome | null = instrumentsSession
    ? await runSource(db, "instruments", instrumentsSession, maxDurationMs, async () => {
        const trading = await sessionByDate(db, instrumentsSession);
        if (!trading) {
          throw new Error(`no trading session recorded for ${instrumentsSession}`);
        }
        const series = await fetchInstrumentsRegistry(instrumentsSession, fetchImpl);
        return upsertOptionSeries(db, trading.close, series);
      })
    : null;

  const sgsSession = await resolveSession("sgs");
  const sgsOutcome: SourceOutcome | null = sgsSession
    ? await runSource(db, "sgs", sgsSession, maxDurationMs, async () => {
        let total = 0;
        for (const series of Object.keys(sgsSeriesCodes) as Array<keyof typeof sgsSeriesCodes>) {
          const since = (await latestMacroPointDate(db, series)) ?? SGS_DEFAULT_START;
          const from = nextDay(since);
          if (from > sgsSession) {
            continue;
          }
          const sessions = await sessionsFrom(db, from);
          const points = await fetchSgsSeries(series, from, sgsSession, sessions, fetchImpl);
          total += await upsertMacroPoints(db, points);
        }
        return total;
      })
    : null;

  const sources = [calendarOutcome, cotahistOutcome, instrumentsOutcome, sgsOutcome].filter(
    (outcome): outcome is SourceOutcome => outcome !== null,
  );

  return {
    session: cotahistSession,
    ok: sources.every((outcome) => outcome.error === undefined),
    sources,
  };
}

function nextDay(isoDate: string): string {
  const date = new Date(`${isoDate}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

export { ingestionSourceValues };
