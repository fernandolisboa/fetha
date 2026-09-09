import type { InstrumentOptionSeries } from "./schema";
import { instrumentOptionSeriesSchema } from "./schema";

const CALL_OPTION_TYPE = "Call";
const PUT_OPTION_TYPE = "Put";

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
  return value.replace(",", ".");
}

// B3's InstrumentsConsolidated registry (endpoints verified 2026-09-09,
// docs/adr/0017): semicolon-delimited latin1 CSV, first line
// "Status do Arquivo: Final", header on the second line. Only option rows
// (`OptnTp` "Call"/"Put") carry the fields we need; every other row (stocks,
// ETFs, ...) is skipped since candles come from COTAHIST instead.
export function parseInstrumentsRegistry(content: string): InstrumentOptionSeries[] {
  const lines = content.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length <= 1) {
    return [];
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

  const series: InstrumentOptionSeries[] = [];
  for (const row of rows) {
    const fields = row.split(";");
    const right = rightFrom(fields[optionTypeIndex] ?? "");
    if (!right) {
      continue;
    }
    const style = styleFrom(fields[styleIndex] ?? "");
    const expiry = fields[expiryIndex]?.trim();
    const rawStrike = fields[strikeIndex]?.trim();
    const isin = fields[isinIndex]?.trim();
    if (!style || !expiry || !rawStrike || !isin) {
      continue;
    }
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
  }
  return series;
}
