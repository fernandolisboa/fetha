import type { InstrumentOptionSeries } from "./schema";
import { instrumentOptionSeriesSchema } from "./schema";

const CALL_CFI_PREFIX = "OC";
const PUT_CFI_PREFIX = "OP";

function styleFrom(optionStyle: string): "american" | "european" | null {
  if (optionStyle === "A") return "american";
  if (optionStyle === "E") return "european";
  return null;
}

// B3's InstrumentsConsolidated registry (docs/research/2026-09-02, section 3):
// semicolon-delimited CSV, one row per instrument. Only option rows (CFICode
// starting "OC"/"OP", ISO 10962) carry the fields we need; every other row
// (stocks, ETFs, ...) is skipped here since candles come from COTAHIST instead.
export function parseInstrumentsRegistry(content: string): InstrumentOptionSeries[] {
  const lines = content.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length === 0) {
    return [];
  }
  const [header, ...rows] = lines;
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
  const underlyingIndex = indexOf("Asst");
  const cfiIndex = indexOf("CFICode");
  const expiryIndex = indexOf("XprtnDt");
  const styleIndex = indexOf("OptnStyle");
  const strikeIndex = indexOf("ExrcPric");

  const series: InstrumentOptionSeries[] = [];
  for (const row of rows) {
    const fields = row.split(";");
    const cfi = fields[cfiIndex] ?? "";
    const prefix = cfi.slice(0, 2);
    if (prefix !== CALL_CFI_PREFIX && prefix !== PUT_CFI_PREFIX) {
      continue;
    }
    const style = styleFrom(fields[styleIndex] ?? "");
    const expiry = fields[expiryIndex]?.trim();
    const strike = fields[strikeIndex]?.trim();
    if (!style || !expiry || !strike) {
      continue;
    }
    series.push(
      instrumentOptionSeriesSchema.parse({
        ticker: fields[tickerIndex],
        underlying: fields[underlyingIndex],
        right: prefix === CALL_CFI_PREFIX ? "call" : "put",
        strike,
        expiry,
        style,
        asOf: fields[reportDateIndex],
      }),
    );
  }
  return series;
}
