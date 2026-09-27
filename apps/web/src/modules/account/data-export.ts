import type { Database } from "@/db/client";
import type { DataExportTables } from "@/lib/data-export";
import { todaySaoPauloDate } from "@/lib/today-sao-paulo";
import type { ScopedUser } from "@/lib/user-scoped-repository";
import { AuditDataExport } from "@/modules/audit";
import { AuthDataExport } from "@/modules/auth";
import { BacktestsDataExport } from "@/modules/backtests";
import { DecisionsDataExport } from "@/modules/decisions";
import { PortfolioDataExport } from "@/modules/portfolio";
import { PreferencesDataExport } from "@/modules/preferences";
import { StrategiesDataExport } from "@/modules/strategies";
import { WatchlistDataExport } from "@/modules/watchlist";

export const EXPORT_FORMAT = "fetha-export/1";

type DataExportSource = new (
  db: Database,
  user: ScopedUser,
) => { tables(): Promise<DataExportTables> };

const SOURCES: readonly DataExportSource[] = [
  AuthDataExport,
  AuditDataExport,
  PreferencesDataExport,
  WatchlistDataExport,
  StrategiesDataExport,
  PortfolioDataExport,
  BacktestsDataExport,
  DecisionsDataExport,
];

// One module at a time and one row per chunk, so no single string holds a
// whole table.
export async function* accountExportChunks(
  db: Database,
  user: ScopedUser,
  exportedAt: Date,
): AsyncGenerator<string> {
  yield `{"format":${JSON.stringify(EXPORT_FORMAT)},"exportedAt":${JSON.stringify(exportedAt.toISOString())},"tables":{`;
  let firstTable = true;
  for (const Source of SOURCES) {
    const tables = await new Source(db, user).tables();
    for (const [name, rows] of Object.entries(tables)) {
      yield `${firstTable ? "" : ","}${JSON.stringify(name)}:[`;
      firstTable = false;
      let firstRow = true;
      for await (const row of rows) {
        yield `${firstRow ? "" : ","}${JSON.stringify(row)}`;
        firstRow = false;
      }
      yield "]";
    }
  }
  yield "}}";
}

// A failure after the headers are out errors the stream, so the browser
// reports a failed download instead of saving a truncated file.
export function accountExportStream(
  db: Database,
  user: ScopedUser,
  exportedAt: Date,
): ReadableStream<Uint8Array> {
  const chunks = accountExportChunks(db, user, exportedAt);
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const next = await chunks.next();
        if (next.done) {
          controller.close();
        } else {
          controller.enqueue(encoder.encode(next.value));
        }
      } catch (error) {
        console.error("account export failed", error instanceof Error ? error.name : "Unknown");
        controller.error(error);
      }
    },
    async cancel() {
      await chunks.return(undefined);
    },
  });
}

export function exportFileName(exportedAt: Date): string {
  return `fetha-dados-${todaySaoPauloDate(exportedAt)}.json`;
}
