import type { Database } from "@/db/client";
import { ingestionSourceValues, type IngestionSource } from "@/db/schema/market-data";

import { fetchTradingSessions } from "./adapters/anbima-calendar/fetch";
import { fetchInstrumentsRegistry } from "./adapters/b3-instruments/fetch";
import { fetchSgsSeries } from "./adapters/bacen-sgs/fetch";
import { sgsSeriesCodes } from "./adapters/bacen-sgs/schema";
import { fetchCotahist } from "./adapters/cotahist/fetch";
import { upsertDailyCandles } from "./repositories/candle-repository";
import { upsertTradingSessions } from "./repositories/calendar-repository";
import { finishRun, findSucceededRun, startRun } from "./repositories/ingestion-run-repository";
import { latestMacroPointDate, upsertMacroPoints } from "./repositories/macro-repository";
import { upsertOptionDailyPrices, upsertOptionSeries } from "./repositories/option-repository";
import { targetSession } from "./session-selection";

const SGS_DEFAULT_START = "2015-01-01";
const CALENDAR_INGESTED_MARKER_SESSION = "01-01";

export interface SourceOutcome {
  source: IngestionSource;
  skipped: boolean;
  rowCount: number;
  error?: string;
}

export interface IngestOutcome {
  session: string | null;
  sources: SourceOutcome[];
}

function calendarMarkerSession(year: number): string {
  return `${String(year)}-${CALENDAR_INGESTED_MARKER_SESSION}`;
}

async function runSource(
  db: Database,
  source: IngestionSource,
  session: string,
  run: () => Promise<number>,
): Promise<SourceOutcome> {
  const existing = await findSucceededRun(db, source, session);
  if (existing) {
    return { source, skipped: true, rowCount: existing.rowCount ?? 0 };
  }

  const runId = await startRun(db, source, session);
  try {
    const rowCount = await run();
    await finishRun(db, runId, { status: "succeeded", rowCount });
    return { source, skipped: false, rowCount };
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    await finishRun(db, runId, { status: "failed", error: message });
    return { source, skipped: false, rowCount: 0, error: message };
  }
}

export interface IngestOptions {
  session?: string;
  now?: Date;
  fetchImpl?: typeof fetch;
}

export async function ingest(db: Database, options: IngestOptions = {}): Promise<IngestOutcome> {
  const now = options.now ?? new Date();
  const fetchImpl = options.fetchImpl ?? fetch;

  const calendarOutcome = await runSource(
    db,
    "calendar",
    calendarMarkerSession(now.getUTCFullYear()),
    async () => {
      const sessions = await fetchTradingSessions(now.getUTCFullYear(), fetchImpl);
      return upsertTradingSessions(db, sessions);
    },
  );

  const session = options.session ?? (await targetSession(db, now));
  if (!session) {
    return { session: null, sources: [calendarOutcome] };
  }
  const asOf = new Date(`${session}T20:00:00.000Z`);

  const cotahistOutcome = await runSource(db, "cotahist", session, async () => {
    const rows = await fetchCotahist(session, fetchImpl);
    const stocks = rows.filter((row) => row.kind === "stock");
    const optionRows = rows.filter((row) => row.kind === "option");
    const candleCount = await upsertDailyCandles(db, session, asOf, stocks);
    const optionCount = await upsertOptionDailyPrices(db, session, asOf, optionRows);
    return candleCount + optionCount;
  });

  const instrumentsOutcome = await runSource(db, "instruments", session, async () => {
    const series = await fetchInstrumentsRegistry(session, fetchImpl);
    return upsertOptionSeries(db, asOf, series);
  });

  const sgsOutcome = await runSource(db, "sgs", session, async () => {
    let total = 0;
    for (const series of Object.keys(sgsSeriesCodes) as Array<keyof typeof sgsSeriesCodes>) {
      const since = (await latestMacroPointDate(db, series)) ?? SGS_DEFAULT_START;
      const from = nextDay(since);
      if (from > session) {
        continue;
      }
      const points = await fetchSgsSeries(series, from, session, fetchImpl);
      total += await upsertMacroPoints(db, points);
    }
    return total;
  });

  return {
    session,
    sources: [calendarOutcome, cotahistOutcome, instrumentsOutcome, sgsOutcome],
  };
}

function nextDay(isoDate: string): string {
  const date = new Date(`${isoDate}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

export { ingestionSourceValues };
