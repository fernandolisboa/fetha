import { z } from "zod";

import type { InstrumentOptionSeries } from "./schema";
import { instrumentOptionSeriesSchema } from "./schema";

const CALL_OPTION_TYPE = "Call";
const PUT_OPTION_TYPE = "Put";

// The registry also lists ~7,400 commodity/FX option rows (SctyCtgyNm blank,
// MktNm "OPTIONS ON FUTURE"/"OPTIONS ON SPOT", e.g. BGIF27C034000) whose
// tickers don't fit tickerSchema; this ticket only covers equities, BDRs,
// ETFs and their options, so anything outside these categories is out of
// scope and dropped before validation, not a parse failure.
const IN_SCOPE_CATEGORIES = new Set([
  "SHARES",
  "BDR",
  "ETF EQUITIES",
  "ETF FOREIGN INDEX",
  "OPTION ON EQUITIES",
  "OPTION ON INDEX",
]);

// An in-scope option row that fails validation (missing required field or a
// value the schema rejects) is a data-quality problem the file itself
// caused, not something this parser can repair; a handful is an
// occasional oddity worth a warning, but a registry with more than this
// many is more likely malformed or shifted than merely noisy, so the whole
// fetch fails loudly instead of silently persisting a partial file.
const MAX_SKIPPED_ROWS = 10;

export interface ParsedInstrumentsRegistry {
  series: InstrumentOptionSeries[];
  skipped: number;
}

function styleFrom(optionStyle: string): "american" | "european" | null {
  if (optionStyle === "AMER") return "american";
  if (optionStyle === "EURO") return "european";
  return null;
}

function rightFrom(optionType: string): "call" | "put" | null {
  if (optionType === CALL_OPTION_TYPE) return "call";
  if (optionType === PUT_OPTION_TYPE) return "put";
  return null;
}

function commaToDot(value: string): string {
  return value.replaceAll(",", ".");
}

// B3's InstrumentsConsolidated registry (endpoints verified 2026-09-09,
// docs/adr/0017): semicolon-delimited latin1 CSV, first line
// "Status do Arquivo: Final", header on the second line. Only option rows
// (`OptnTp` "Call"/"Put") carry the fields we need; every other row (stocks,
// ETFs, ...) is skipped since candles come from COTAHIST instead.
export function parseInstrumentsRegistry(content: string): ParsedInstrumentsRegistry {
  const lines = content.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length <= 1) {
    return { series: [], skipped: 0 };
  }
  const [, header, ...rows] = lines;
  const columns = (header ?? "").split(";");
  const indexOf = (name: string): number => {
    const index = columns.indexOf(name);
    if (index === -1) {
      throw new Error(`instruments registry missing column "${name}"`);
    }
    return index;
  };

  const reportDateIndex = indexOf("RptDt");
  const tickerIndex = indexOf("TckrSymb");
  const isinIndex = indexOf("ISIN");
  const underlyingIndex = indexOf("Asst");
  const expiryIndex = indexOf("XprtnDt");
  const styleIndex = indexOf("OptnStyle");
  const strikeIndex = indexOf("ExrcPric");
  const optionTypeIndex = indexOf("OptnTp");
  const categoryIndex = indexOf("SctyCtgyNm");

  const series: InstrumentOptionSeries[] = [];
  let skipped = 0;
  for (const row of rows) {
    const fields = row.split(";");
    const category = fields[categoryIndex]?.trim() ?? "";
    if (!IN_SCOPE_CATEGORIES.has(category)) {
      continue;
    }
    const right = rightFrom(fields[optionTypeIndex] ?? "");
    if (!right) {
      continue;
    }
    const style = styleFrom(fields[styleIndex] ?? "");
    const expiry = fields[expiryIndex]?.trim();
    const rawStrike = fields[strikeIndex]?.trim();
    const isin = fields[isinIndex]?.trim();
    if (!style || !expiry || !rawStrike || !isin) {
      skipped += 1;
      continue;
    }
    try {
      series.push(
        instrumentOptionSeriesSchema.parse({
          ticker: fields[tickerIndex],
          isin,
          underlying: fields[underlyingIndex],
          right,
          strike: commaToDot(rawStrike),
          expiry,
          style,
          asOf: fields[reportDateIndex],
        }),
      );
    } catch (error) {
      if (error instanceof z.ZodError) {
        skipped += 1;
        continue;
      }
      throw error;
    }
  }
  if (skipped > MAX_SKIPPED_ROWS) {
    throw new Error(
      `instruments registry: skipped ${String(skipped)} non-conforming in-scope row(s), ` +
        `more than the ${String(MAX_SKIPPED_ROWS)} allowed`,
    );
  }
  if (skipped > 0) {
    console.warn(`instruments registry: skipped ${String(skipped)} non-conforming row(s)`);
  }
  return { series, skipped };
}
