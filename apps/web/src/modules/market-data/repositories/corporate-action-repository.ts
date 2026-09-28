import { asc, eq } from "drizzle-orm";
import {
  decimalStringSchema,
  sessionDateSchema,
  tickerSchema,
  type DecimalString,
  type SessionDate,
  type Ticker,
} from "@fetha/contracts";

import type { Database } from "@/db/client";
import { corporateActionFactors } from "../schema";

export interface CorporateActionFactorRow {
  ticker: Ticker;
  exDate: SessionDate;
  asOf: Date;
  factor: DecimalString;
}

// The repository is the one edge storage-shaped rows cross (CLAUDE.md
// "validation at the edges"): every caller downstream gets `Ticker`,
// `SessionDate` and `DecimalString`, never a raw `string` to re-parse.
export async function corporateActionsForTicker(
  db: Database,
  ticker: string,
): Promise<CorporateActionFactorRow[]> {
  const rows = await db
    .select()
    .from(corporateActionFactors)
    .where(eq(corporateActionFactors.ticker, ticker))
    .orderBy(asc(corporateActionFactors.exDate));
  return rows.map((row) => ({
    ticker: tickerSchema.parse(row.ticker),
    exDate: sessionDateSchema.parse(row.exDate),
    asOf: row.asOf,
    factor: decimalStringSchema.parse(row.factor),
  }));
}
