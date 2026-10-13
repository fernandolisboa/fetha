import type { Database } from "@/db/client";
import { todaySaoPauloDate } from "@/lib/today-sao-paulo";

import { CvmFetchError, fetchFcaTickers, fetchIpeFilings } from "./adapters/cvm/fetch";
import type { CompanyTicker } from "./adapters/cvm/schema";
import type { RunResult } from "./ingest";
import {
  insertCompanyFilings,
  latestFilingDeliveredOn,
  upsertCompanyTickers,
} from "./repositories/company-filing-repository";

// CVM regenerates the yearly files every few days, so each night re-reads
// the whole year but only sends rows delivered within this window of the
// newest stored filing; anything older is already stored (docs/adr/0060).
const OVERLAP_DAYS = 30;
// Until April the current year's file is too short to fill the asset page's
// panel, so the previous year's file is read too.
const LAST_MONTH_READING_PREVIOUS_YEAR = 3;

function daysBefore(isoDate: string, days: number): string {
  const date = new Date(`${isoDate}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

function newestPerTicker(tickers: readonly CompanyTicker[]): CompanyTicker[] {
  const byTicker = new Map<string, CompanyTicker>();
  for (const ticker of tickers) {
    const existing = byTicker.get(ticker.ticker);
    if (!existing || ticker.referenceDate > existing.referenceDate) {
      byTicker.set(ticker.ticker, ticker);
    }
  }
  return [...byTicker.values()];
}

export async function ingestCvmFilings(
  db: Database,
  now: Date,
  fetchImpl: typeof fetch,
): Promise<RunResult> {
  const today = todaySaoPauloDate(now);
  const year = Number(today.slice(0, 4));
  const month = Number(today.slice(5, 7));
  const ipeYears = month <= LAST_MONTH_READING_PREVIOUS_YEAR ? [year - 1, year] : [year];

  const [ipe, fca] = await Promise.all([
    Promise.all(ipeYears.map((ipeYear) => fetchIpeFilings(ipeYear, fetchImpl))),
    Promise.all([year - 1, year].map((fcaYear) => fetchFcaTickers(fcaYear, fetchImpl))),
  ]);
  const fcaFiles = fca.filter((parsed) => parsed !== null);
  if (fcaFiles.length === 0) {
    throw new CvmFetchError("CVM has no FCA file for this or last year");
  }

  const parsedFilings = ipe.flatMap((parsed) => parsed?.filings ?? []);
  // A delivery date past today is a garbled row; it would otherwise become
  // the newest stored filing and push the cutoff past every real one.
  const filings = parsedFilings.filter((filing) => filing.deliveredOn <= today);
  const futureRows = parsedFilings.length - filings.length;

  const latest = await latestFilingDeliveredOn(db);
  const cutoff = latest === undefined ? undefined : daysBefore(latest, OVERLAP_DAYS);
  // One transaction, because the cutoff is read from what is stored: a run
  // cut short after some batches must leave nothing behind, or the next run
  // would skip everything older than the batches that did land.
  const rowCount = await db.transaction(async (tx) => {
    const tickerCount = await upsertCompanyTickers(
      tx,
      newestPerTicker(fcaFiles.flatMap((parsed) => parsed.tickers)),
    );
    const filingCount = await insertCompanyFilings(
      tx,
      filings.filter((filing) => cutoff === undefined || filing.deliveredOn >= cutoff),
    );
    return tickerCount + filingCount;
  });

  if (ipe.at(-1) === null) {
    return { rowCount, pending: true };
  }
  const skippedRows = [...ipe, ...fca].reduce(
    (total, parsed) => total + (parsed?.skipped ?? 0),
    futureRows,
  );
  return skippedRows > 0 ? { rowCount, skippedRows } : rowCount;
}
