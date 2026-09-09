import Decimal from "decimal.js";

import type { CotahistRow } from "./schema";
import { cotahistRowSchema } from "./schema";

// Positions per the B3 COTAHIST fixed-width layout (245 bytes/line, 1-based,
// inclusive). Record type 01 = daily quotation; 00 = header; 99 = trailer.
const RECORD_TYPE = [0, 2] as const;
const REFERENCE_DATE = [2, 10] as const;
const TICKER = [12, 24] as const;
const MARKET_TYPE = [24, 27] as const;
const OPEN = [56, 69] as const;
const HIGH = [69, 82] as const;
const LOW = [82, 95] as const;
const AVERAGE = [95, 108] as const;
const CLOSE = [108, 121] as const;
const TRADES = [147, 152] as const;
const TRADED_QUANTITY = [152, 170] as const;
const STRIKE = [188, 201] as const;
const EXPIRY = [202, 210] as const;
const QUOTATION_FACTOR = [210, 217] as const;

const CASH_MARKET_TYPES = new Set(["010"]);
const CALL_MARKET_TYPE = "070";
const PUT_MARKET_TYPE = "080";
const OPTION_MARKET_TYPES = new Set([CALL_MARKET_TYPE, PUT_MARKET_TYPE]);

const RECORD_LENGTH = 245;

function slice(line: string, [start, end]: readonly [number, number]): string {
  return line.slice(start, end).trim();
}

function toIsoDate(yyyymmdd: string): string {
  return `${yyyymmdd.slice(0, 4)}-${yyyymmdd.slice(4, 6)}-${yyyymmdd.slice(6, 8)}`;
}

function toDecimalString(digits: string): string {
  return new Decimal(digits || "0").dividedBy(100).toFixed(2);
}

export class CotahistParseError extends Error {
  constructor(
    message: string,
    public readonly lineNumber: number,
  ) {
    super(message);
    this.name = "CotahistParseError";
  }
}

function applyQuotationFactor(price: string, factor: string): string {
  const factorValue = new Decimal(factor || "1");
  if (factorValue.isZero()) {
    return price;
  }
  return new Decimal(price).dividedBy(factorValue).toFixed(2);
}

function parseDailyQuotationLine(line: string, lineNumber: number): CotahistRow | null {
  const marketType = slice(line, MARKET_TYPE);
  const session = toIsoDate(slice(line, REFERENCE_DATE));
  const ticker = slice(line, TICKER);
  const trades = Number.parseInt(slice(line, TRADES), 10);
  const tradedQuantity = Number.parseInt(slice(line, TRADED_QUANTITY), 10);
  const rawFactor = slice(line, QUOTATION_FACTOR);
  const factor = rawFactor ? String(Number.parseInt(rawFactor, 10)) : "1";

  const open = applyQuotationFactor(toDecimalString(slice(line, OPEN)), factor);
  const high = applyQuotationFactor(toDecimalString(slice(line, HIGH)), factor);
  const low = applyQuotationFactor(toDecimalString(slice(line, LOW)), factor);
  const average = applyQuotationFactor(toDecimalString(slice(line, AVERAGE)), factor);
  const close = applyQuotationFactor(toDecimalString(slice(line, CLOSE)), factor);

  if (CASH_MARKET_TYPES.has(marketType)) {
    const row = {
      kind: "stock" as const,
      session,
      ticker,
      open,
      high,
      low,
      average,
      close,
      trades,
      tradedQuantity,
    };
    return cotahistRowSchema.parse(row);
  }

  if (OPTION_MARKET_TYPES.has(marketType)) {
    const strike = applyQuotationFactor(toDecimalString(slice(line, STRIKE)), factor);
    const expiryDigits = slice(line, EXPIRY);
    if (expiryDigits.length !== 8) {
      throw new CotahistParseError("option row missing DATVEN (expiry)", lineNumber);
    }
    const row = {
      kind: "option" as const,
      session,
      ticker,
      right: marketType === CALL_MARKET_TYPE ? ("call" as const) : ("put" as const),
      strike,
      expiry: toIsoDate(expiryDigits),
      factor,
      open,
      high,
      low,
      average,
      close,
      trades,
      tradedQuantity,
    };
    return cotahistRowSchema.parse(row);
  }

  return null;
}

export function parseCotahist(content: string): CotahistRow[] {
  const rows: CotahistRow[] = [];
  const lines = content.split(/\r?\n/).filter((line) => line.length > 0);

  lines.forEach((line, index) => {
    const lineNumber = index + 1;
    if (line.length < RECORD_LENGTH) {
      throw new CotahistParseError(
        `expected a ${String(RECORD_LENGTH)}-byte record, got ${String(line.length)}`,
        lineNumber,
      );
    }
    const recordType = slice(line, RECORD_TYPE);
    if (recordType === "00" || recordType === "99") {
      return;
    }
    if (recordType !== "01") {
      throw new CotahistParseError(`unknown record type "${recordType}"`, lineNumber);
    }
    const row = parseDailyQuotationLine(line, lineNumber);
    if (row) {
      rows.push(row);
    }
  });

  return rows;
}
